import { Inject, Injectable } from '@nestjs/common';
import { and, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';

import { PLATFORM_DB } from '../database';
import type { PlatformDatabase } from '../database';

/** pg-boss 的表放在自己的 schema，與業務表分開（docs/architecture/backend/10-jobs.md §2）。 */
export const JOB_SCHEMA = 'pgboss';

export const JOB_STATES = [
  'created',
  'retry',
  'active',
  'completed',
  'cancelled',
  'failed',
] as const;
export type JobState = (typeof JOB_STATES)[number];

export interface JobRecord {
  id: string;
  name: string;
  /** 屬於哪個租戶（信封的 `tenantId`）；平台工作是 null。 */
  tenantId: string | null;
  state: JobState;
  /** 入列時的資料（信封裡的 `payload`，docs/architecture/05-tenancy.md §10.2 D15）。 */
  data: Record<string, unknown> | null;
  /** 完成時是 handler 的回傳值；失敗時是序列化的錯誤（`message`、`stack`…）。 */
  output: Record<string, unknown> | null;
  retryCount: number;
  retryLimit: number;
  createdOn: Date;
  startAfter: Date;
  startedOn: Date | null;
  completedOn: Date | null;
}

/** 一個佇列各狀態的筆數（保留期內）。 */
export interface JobQueueCounts {
  /** 可以立即執行、等 worker 取走。 */
  readyCount: number;
  /** 排定在未來（延後入列、重試退避中）。 */
  deferredCount: number;
  activeCount: number;
  /** 重試用完而停下的。 */
  failedCount: number;
  completedCount: number;
}

/**
 * 看誰的工作：租戶 id（租戶的管理頁只看自己的）、`null`（只看平台工作）、`undefined`（全部，只有平台的監控頁用）。
 */
export type JobOwnerFilter = string | null | undefined;

export interface JobListFilter {
  tenantId: JobOwnerFilter;
  /** 只看這些佇列（已註冊的工作）；pg-boss 內部或死信佇列不列出。 */
  names: string[];
  name?: string;
  state?: JobState;
  offset: number;
  limit: number;
}

const JOB_TABLE = sql.raw(`${JOB_SCHEMA}.job`);

const JOB_COLUMNS = sql`
  id, name, state::text AS state, data->>'tenantId' AS "tenantId", data->'payload' AS data, output,
  retry_count AS "retryCount", retry_limit AS "retryLimit",
  created_on AS "createdOn", start_after AS "startAfter",
  started_on AS "startedOn", completed_on AS "completedOn"`;

/**
 * 讀 pg-boss 的工作表給管理頁用。pg-boss 的 API 只能逐一佇列查、不能分頁，所以直接查表；
 * 表結構屬於 pg-boss，只在這個檔案出現，升級 pg-boss 時對照它的 migration 檢查這裡。
 * 佇列在平台 DB、所有租戶共用，每個查詢都以信封的 `tenantId` 過濾（`JobEnvelope`）；只有平台的監控頁看全部（`JobOwnerFilter`）。
 */
@Injectable()
export class JobStore {
  constructor(@Inject(PLATFORM_DB) private readonly db: PlatformDatabase) {}

  async list(filter: JobListFilter): Promise<{ items: JobRecord[]; total: number }> {
    if (filter.names.length === 0) return { items: [], total: 0 };
    const where = and(
      ofTenant(filter.tenantId),
      inNames(filter.names),
      filter.name ? sql`name = ${filter.name}` : undefined,
      filter.state ? sql`state = ${filter.state}::${sql.raw(JOB_SCHEMA)}.job_state` : undefined,
    ) as SQL;
    const [items, [count]] = await Promise.all([
      this.db.execute<JobRecordRow>(
        sql`SELECT ${JOB_COLUMNS} FROM ${JOB_TABLE} WHERE ${where}
            ORDER BY created_on DESC, id DESC LIMIT ${filter.limit} OFFSET ${filter.offset}`,
      ),
      this.db.execute<{ total: number }>(
        sql`SELECT count(*)::int AS total FROM ${JOB_TABLE} WHERE ${where}`,
      ),
    ]);
    return { items: items.map(toRecord), total: count?.total ?? 0 };
  }

  /**
   * 即時計數。pg-boss 的 `getQueues()` 是監控迴圈定期寫入的快照（最多落後一分鐘），
   * 管理頁剛重試完就要看到數字變，所以直接數。
   */
  async counts(tenantId: JobOwnerFilter, names: string[]): Promise<Map<string, JobQueueCounts>> {
    const result = new Map<string, JobQueueCounts>(
      names.map((name) => [
        name,
        { readyCount: 0, deferredCount: 0, activeCount: 0, failedCount: 0, completedCount: 0 },
      ]),
    );
    if (names.length === 0) return result;
    // interface 沒有索引簽章，db.execute 的泛型要求 Record；用映射型別轉一次
    const rows = await this.db.execute<{ name: string } & { [K in keyof JobQueueCounts]: number }>(
      sql`SELECT name,
            count(*) FILTER (WHERE state IN ('created', 'retry') AND start_after <= now())::int AS "readyCount",
            count(*) FILTER (WHERE state IN ('created', 'retry') AND start_after > now())::int AS "deferredCount",
            count(*) FILTER (WHERE state = 'active')::int AS "activeCount",
            count(*) FILTER (WHERE state = 'failed')::int AS "failedCount",
            count(*) FILTER (WHERE state = 'completed')::int AS "completedCount"
          FROM ${JOB_TABLE} WHERE ${ofTenant(tenantId)} AND ${inNames(names)} GROUP BY name`,
    );
    for (const { name, ...counts } of rows) result.set(name, counts);
    return result;
  }

  async find(
    tenantId: JobOwnerFilter,
    names: string[],
    id: string,
  ): Promise<JobRecord | undefined> {
    if (names.length === 0) return undefined;
    const [row] = await this.db.execute<JobRecordRow>(
      sql`SELECT ${JOB_COLUMNS} FROM ${JOB_TABLE}
          WHERE id = ${id} AND ${ofTenant(tenantId)} AND ${inNames(names)}`,
    );
    return row ? toRecord(row) : undefined;
  }

  /**
   * 這個租戶有幾筆 `active` 的工作排在 `jobId` 之前（依 `(started_on, id)`；docs/architecture/05-tenancy.md §13.3 D9）。
   * 每個 worker 都以同一個順序判斷，同時取到的幾筆裡只有排在上限以內的會執行，不必另外上鎖。
   * `jobId` 已不是 `active`（逾時被收回）時回 0：交給 pg-boss 自己處理。
   */
  async activeAhead(tenantId: string, jobId: string): Promise<number> {
    const [row] = await this.db.execute<{ ahead: number }>(
      sql`WITH me AS (
            SELECT started_on, id FROM ${JOB_TABLE} WHERE id = ${jobId} AND state = 'active'
          )
          SELECT count(*)::int AS ahead FROM ${JOB_TABLE} j, me
          WHERE j.state = 'active' AND j.data->>'tenantId' = ${tenantId}
            AND (j.started_on, j.id) < (me.started_on, me.id)`,
    );
    return row?.ahead ?? 0;
  }

  /**
   * 把執行中的工作放回佇列（docs/architecture/05-tenancy.md §13.3 D9）：改回 `created`、`start_after` 延後，**不** 動重試次數，工作 id 不變。
   * pg-boss 的 API 只能更新還沒開始的工作，所以直接改表；之後 handler 回傳時 pg-boss 的完成只更新 `active` 的列，是空操作。
   *
   * `conflict`：`exclusive`（stately）佇列已有一筆排隊，唯一索引擋下——排隊中的那一筆會做同一件事。
   * `gone`：工作已不是 `active`（逾時被收回、被取消）。
   */
  async requeue(
    name: string,
    jobId: string,
    delaySeconds: number,
  ): Promise<'requeued' | 'conflict' | 'gone'> {
    try {
      const rows = await this.db.execute<{ id: string }>(
        sql`UPDATE ${JOB_TABLE}
            SET state = 'created', started_on = NULL, heartbeat_on = NULL,
                start_after = now() + make_interval(secs => ${delaySeconds})
            WHERE name = ${name} AND id = ${jobId} AND state = 'active'
            RETURNING id`,
      );
      return rows.length ? 'requeued' : 'gone';
    } catch (error) {
      if ((error as { code?: string }).code === '23505') return 'conflict';
      throw error;
    }
  }
}

function ofTenant(tenantId: JobOwnerFilter): SQL {
  if (tenantId === undefined) return sql`true`;
  if (tenantId === null) return sql`data->>'tenantId' IS NULL`;
  return sql`data->>'tenantId' = ${tenantId}`;
}

function inNames(names: string[]): SQL {
  return sql`name IN (${sql.join(
    names.map((name) => sql`${name}`),
    sql`, `,
  )})`;
}

/** postgres.js 對 `db.execute` 的時間欄位回傳字串；在這裡轉成 Date，呼叫端不必知道。 */
type JobRecordRow = Omit<JobRecord, 'createdOn' | 'startAfter' | 'startedOn' | 'completedOn'> & {
  createdOn: string | Date;
  startAfter: string | Date;
  startedOn: string | Date | null;
  completedOn: string | Date | null;
};

function toRecord(row: JobRecordRow): JobRecord {
  return {
    ...row,
    createdOn: new Date(row.createdOn),
    startAfter: new Date(row.startAfter),
    startedOn: row.startedOn === null ? null : new Date(row.startedOn),
    completedOn: row.completedOn === null ? null : new Date(row.completedOn),
  };
}
