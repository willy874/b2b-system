import { Inject, Injectable } from '@nestjs/common';
import {
  and,
  arrayContains,
  asc,
  count,
  desc,
  eq,
  exists,
  ilike,
  inArray,
  lt,
  ne,
  notInArray,
  or,
  sql,
} from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';

import type { Database, DbOrTx } from '@/core/database';
import { containsPattern, TENANT_DB } from '@/core/database';
import {
  users,
  webhookDeliveries,
  webhookEvents,
  webhookSubscriptions,
  webhookTargets,
} from '@/db/schema';
import type {
  WebhookDeliveryRow,
  WebhookEventRow,
  WebhookSubscriptionInsert,
  WebhookSubscriptionRow,
  WebhookTargetRow,
} from '@/db/schema';

import type { ListWebhookDeliveryDto, ListWebhookDto } from './dto/webhook.dto';

export interface WebhookSubscriptionWithCreator extends WebhookSubscriptionRow {
  creator: { id: string; displayName: string } | null;
  /** 目標網址，依 `position`（docs/architecture/backend/17-webhook.md §10.2 D12）。 */
  targets: WebhookTargetRow[];
}

/** `emit()` 要入列的一筆：某個啟用中訂閱的某個網址。 */
export interface ActiveWebhookTarget {
  subscriptionId: string;
  targetId: string;
}

export interface WebhookDeliveryWithEvent extends WebhookDeliveryRow {
  event: Pick<WebhookEventRow, 'type' | 'data' | 'occurredAt'>;
}

export interface NewWebhookDelivery {
  subscriptionId: string;
  eventId: string;
  targetId: string;
  url: string;
  attempt: number;
  trigger: 'auto' | 'manual';
  succeeded: boolean;
  responseStatus: number | null;
  durationMs: number;
  responseBody: string | null;
  error: string | null;
}

/** 投遞失敗後的狀態：網址的連續失敗次數；`disabledNow` = 這一次讓訂閱到達門檻而停用。 */
export interface FailureResult {
  consecutiveFailures: number;
  disabledNow: boolean;
}

const CREATOR = sql<{ id: string; displayName: string } | null>`
  CASE WHEN ${users.id} IS NULL THEN NULL
  ELSE json_build_object('id', ${users.id}, 'displayName', ${users.displayName}) END`;

/** Webhook 的訂閱、事件與投遞紀錄（docs/architecture/backend/17-webhook.md §9.2 D7、D9、D12）。 */
@Injectable()
export class WebhookRepository {
  constructor(@Inject(TENANT_DB) private readonly db: Database) {}

  // ── 訂閱 ─────────────────────────────────────────────

  async list(
    query: ListWebhookDto,
  ): Promise<{ items: WebhookSubscriptionWithCreator[]; total: number }> {
    const conditions: SQL[] = [];
    if (query.status) conditions.push(eq(webhookSubscriptions.status, query.status));
    if (query.keyword) {
      const pattern = containsPattern(query.keyword);
      const matched = or(
        ilike(webhookSubscriptions.name, pattern),
        exists(
          this.db
            .select({ one: sql`1` })
            .from(webhookTargets)
            .where(
              and(
                eq(webhookTargets.subscriptionId, webhookSubscriptions.id),
                ilike(webhookTargets.url, pattern),
              ),
            ),
        ),
      );
      if (matched) conditions.push(matched);
    }
    const where = conditions.length ? and(...conditions) : undefined;
    const [rows, [totalRow]] = await Promise.all([
      this.db
        .select({ subscription: webhookSubscriptions, creator: CREATOR })
        .from(webhookSubscriptions)
        .leftJoin(users, eq(users.id, webhookSubscriptions.createdBy))
        .where(where)
        .orderBy(desc(webhookSubscriptions.createdAt), desc(webhookSubscriptions.id))
        .limit(query.limit)
        .offset(query.offset),
      this.db.select({ total: count() }).from(webhookSubscriptions).where(where),
    ]);
    const targets = await this.targetsOf(rows.map(({ subscription }) => subscription.id));
    return {
      items: rows.map(({ subscription, creator }) => ({
        ...subscription,
        creator,
        targets: targets.get(subscription.id) ?? [],
      })),
      total: totalRow?.total ?? 0,
    };
  }

  async findById(id: string, tx?: DbOrTx): Promise<WebhookSubscriptionWithCreator | undefined> {
    const [row] = await (tx ?? this.db)
      .select({ subscription: webhookSubscriptions, creator: CREATOR })
      .from(webhookSubscriptions)
      .leftJoin(users, eq(users.id, webhookSubscriptions.createdBy))
      .where(eq(webhookSubscriptions.id, id));
    if (!row) return undefined;
    const targets = await this.targetsOf([id], tx);
    return { ...row.subscription, creator: row.creator, targets: targets.get(id) ?? [] };
  }

  // ── 目標網址 ─────────────────────────────────────────

  /** 一批訂閱的網址（一次查完），依 `position`。 */
  private async targetsOf(
    subscriptionIds: string[],
    tx?: DbOrTx,
  ): Promise<Map<string, WebhookTargetRow[]>> {
    const result = new Map<string, WebhookTargetRow[]>();
    if (!subscriptionIds.length) return result;
    const rows = await (tx ?? this.db)
      .select()
      .from(webhookTargets)
      .where(inArray(webhookTargets.subscriptionId, subscriptionIds))
      .orderBy(asc(webhookTargets.position));
    for (const row of rows) {
      const list = result.get(row.subscriptionId) ?? [];
      list.push(row);
      result.set(row.subscriptionId, list);
    }
    return result;
  }

  async findTarget(
    subscriptionId: string,
    targetId: string,
  ): Promise<WebhookTargetRow | undefined> {
    const [row] = await this.db
      .select()
      .from(webhookTargets)
      .where(
        and(eq(webhookTargets.id, targetId), eq(webhookTargets.subscriptionId, subscriptionId)),
      );
    return row;
  }

  /**
   * 租戶所有訂閱裡不重複的網址（docs/architecture/05-tenancy.md §13.3 D11）；給了 `excludeSubscriptionId`
   * 就不算那個訂閱（修改時換成它的新網址再算）。呼叫前先 `lockForCount`。
   */
  async distinctUrls(tx: DbOrTx, excludeSubscriptionId?: string): Promise<string[]> {
    const rows = await tx
      .selectDistinct({ url: webhookTargets.url })
      .from(webhookTargets)
      .where(
        excludeSubscriptionId
          ? ne(webhookTargets.subscriptionId, excludeSubscriptionId)
          : undefined,
      );
    return rows.map((row) => row.url);
  }

  /**
   * 以新的網址清單取代（D13）：沒變的網址保留（id 與失敗次數不變）、移除的刪掉（投遞紀錄的 `target_id` 設為 null）、
   * 新的加入；順序依清單。
   */
  async replaceTargets(subscriptionId: string, urls: string[], tx: DbOrTx): Promise<void> {
    await tx
      .delete(webhookTargets)
      .where(
        and(
          eq(webhookTargets.subscriptionId, subscriptionId),
          urls.length ? notInArray(webhookTargets.url, urls) : undefined,
        ),
      );
    await tx
      .insert(webhookTargets)
      .values(urls.map((url, position) => ({ subscriptionId, url, position })))
      .onConflictDoUpdate({
        target: [webhookTargets.subscriptionId, webhookTargets.url],
        set: { position: sql`excluded.position` },
      });
  }

  /** 重新啟用時所有網址的失敗次數歸零（docs/architecture/backend/17-webhook.md §10.2 D15）。 */
  async resetTargetFailures(subscriptionId: string, tx: DbOrTx): Promise<void> {
    await tx
      .update(webhookTargets)
      .set({ consecutiveFailures: 0 })
      .where(eq(webhookTargets.subscriptionId, subscriptionId));
  }

  async countAll(tx?: DbOrTx): Promise<number> {
    const [row] = await (tx ?? this.db).select({ total: count() }).from(webhookSubscriptions);
    return row?.total ?? 0;
  }

  /**
   * 建立與修改網址前鎖住整張表的計數：同時建立兩個不會一起超過訂閱數與網址數的上限
   * （所有改變網址的寫入都經過這裡，鎖訂閱表就夠了）。
   */
  async lockForCount(tx: DbOrTx): Promise<void> {
    await tx.execute(sql`LOCK TABLE ${webhookSubscriptions} IN SHARE ROW EXCLUSIVE MODE`);
  }

  async create(values: WebhookSubscriptionInsert, tx: DbOrTx): Promise<WebhookSubscriptionRow> {
    const [row] = await tx.insert(webhookSubscriptions).values(values).returning();
    if (!row) throw new Error('webhook_subscriptions 寫入沒有回傳列');
    return row;
  }

  /** 條件式 UPDATE（樂觀鎖）：版本不符或列已不在回 `undefined`。 */
  async update(
    id: string,
    values: Partial<WebhookSubscriptionInsert>,
    expectedVersion: number,
    tx: DbOrTx,
  ): Promise<WebhookSubscriptionRow | undefined> {
    const [row] = await tx
      .update(webhookSubscriptions)
      .set({ ...values, version: sql`${webhookSubscriptions.version} + 1`, updatedAt: new Date() })
      .where(
        and(eq(webhookSubscriptions.id, id), eq(webhookSubscriptions.version, expectedVersion)),
      )
      .returning();
    return row;
  }

  /** 輪替密鑰：不改 `version`（不是使用者編輯的欄位，不該讓開著編輯框的人 409）。 */
  async replaceSecret(
    id: string,
    secretEncrypted: string,
    updatedBy: string,
    tx: DbOrTx,
  ): Promise<WebhookSubscriptionRow | undefined> {
    const [row] = await tx
      .update(webhookSubscriptions)
      .set({ secretEncrypted, updatedBy, updatedAt: new Date() })
      .where(eq(webhookSubscriptions.id, id))
      .returning();
    return row;
  }

  async delete(id: string, tx: DbOrTx): Promise<boolean> {
    const rows = await tx
      .delete(webhookSubscriptions)
      .where(eq(webhookSubscriptions.id, id))
      .returning({ id: webhookSubscriptions.id });
    return rows.length > 0;
  }

  /**
   * 訂閱了這個事件的啟用中訂閱的每個網址（`emit()` 在業務交易內呼叫；訂閱走部分 GIN 索引；docs/architecture/backend/17-webhook.md §10.2 D14）。
   */
  async findActiveTargetsByEvent(type: string, tx: DbOrTx): Promise<ActiveWebhookTarget[]> {
    return tx
      .select({ subscriptionId: webhookTargets.subscriptionId, targetId: webhookTargets.id })
      .from(webhookTargets)
      .innerJoin(webhookSubscriptions, eq(webhookSubscriptions.id, webhookTargets.subscriptionId))
      .where(
        and(
          eq(webhookSubscriptions.status, 'active'),
          arrayContains(webhookSubscriptions.events, [type]),
        ),
      )
      .orderBy(asc(webhookTargets.subscriptionId), asc(webhookTargets.position));
  }

  /** 投遞成功：這個網址的失敗次數歸零，訂閱與網址的最後投遞時間更新。不改 `version`（系統寫入）。 */
  async recordSuccess(
    subscriptionId: string,
    targetId: string,
    at: Date,
    tx: DbOrTx,
  ): Promise<void> {
    await tx
      .update(webhookTargets)
      .set({ consecutiveFailures: 0, lastDeliveryAt: at })
      .where(eq(webhookTargets.id, targetId));
    await tx
      .update(webhookSubscriptions)
      .set({ lastDeliveryAt: at })
      .where(eq(webhookSubscriptions.id, subscriptionId));
  }

  /**
   * 投遞失敗：這個網址的失敗次數加一；到門檻而訂閱仍是啟用中就停用整個訂閱（`disabled_reason = 'failing'`，
   * docs/architecture/backend/17-webhook.md §10.2 D15）。停用的 UPDATE 以 `status = 'active'` 為條件：
   * 兩個並行的失敗只有先到的那一個改得到，不會都以為自己是讓它停用的那一次。網址已被移除時回 `undefined`。
   */
  async recordFailure(
    subscriptionId: string,
    targetId: string,
    at: Date,
    threshold: number,
    tx: DbOrTx,
  ): Promise<FailureResult | undefined> {
    const [target] = await tx
      .update(webhookTargets)
      .set({
        consecutiveFailures: sql`${webhookTargets.consecutiveFailures} + 1`,
        lastDeliveryAt: at,
      })
      .where(eq(webhookTargets.id, targetId))
      .returning({ consecutiveFailures: webhookTargets.consecutiveFailures });
    await tx
      .update(webhookSubscriptions)
      .set({ lastDeliveryAt: at })
      .where(eq(webhookSubscriptions.id, subscriptionId));
    if (!target) return undefined;
    if (target.consecutiveFailures < threshold) {
      return { consecutiveFailures: target.consecutiveFailures, disabledNow: false };
    }
    const disabled = await tx
      .update(webhookSubscriptions)
      .set({
        status: 'disabled',
        disabledReason: 'failing',
        version: sql`${webhookSubscriptions.version} + 1`,
      })
      .where(
        and(eq(webhookSubscriptions.id, subscriptionId), eq(webhookSubscriptions.status, 'active')),
      )
      .returning({ id: webhookSubscriptions.id });
    return { consecutiveFailures: target.consecutiveFailures, disabledNow: disabled.length > 0 };
  }

  // ── 事件 ─────────────────────────────────────────────

  async insertEvent(
    values: { type: string; version: number; data: Record<string, unknown> },
    tx: DbOrTx,
  ): Promise<WebhookEventRow> {
    const [row] = await tx.insert(webhookEvents).values(values).returning();
    if (!row) throw new Error('webhook_events 寫入沒有回傳列');
    return row;
  }

  async findEvent(id: string): Promise<WebhookEventRow | undefined> {
    const [row] = await this.db.select().from(webhookEvents).where(eq(webhookEvents.id, id));
    return row;
  }

  /** 清理：刪掉 `cutoff` 之前的事件（投遞紀錄隨之 CASCADE）；回傳這一批刪了幾筆。 */
  async deleteEventsBefore(cutoff: Date, limit: number): Promise<number> {
    const rows = await this.db
      .delete(webhookEvents)
      .where(
        inArray(
          webhookEvents.id,
          this.db
            .select({ id: webhookEvents.id })
            .from(webhookEvents)
            .where(lt(webhookEvents.occurredAt, cutoff))
            .limit(limit),
        ),
      )
      .returning({ id: webhookEvents.id });
    return rows.length;
  }

  // ── 投遞紀錄 ─────────────────────────────────────────

  async insertDelivery(values: NewWebhookDelivery, tx?: DbOrTx): Promise<WebhookDeliveryRow> {
    const [row] = await (tx ?? this.db).insert(webhookDeliveries).values(values).returning();
    if (!row) throw new Error('webhook_deliveries 寫入沒有回傳列');
    return row;
  }

  /** 這個事件對這個網址已經嘗試過幾次（下一次的 `attempt` = 它 + 1）。 */
  async countAttempts(targetId: string, eventId: string): Promise<number> {
    const [row] = await this.db
      .select({ total: count() })
      .from(webhookDeliveries)
      .where(and(eq(webhookDeliveries.targetId, targetId), eq(webhookDeliveries.eventId, eventId)));
    return row?.total ?? 0;
  }

  async listDeliveries(
    subscriptionId: string,
    query: ListWebhookDeliveryDto,
  ): Promise<{ items: WebhookDeliveryWithEvent[]; total: number }> {
    const conditions: SQL[] = [eq(webhookDeliveries.subscriptionId, subscriptionId)];
    if (query.succeeded !== undefined) {
      conditions.push(eq(webhookDeliveries.succeeded, query.succeeded));
    }
    if (query.targetId) conditions.push(eq(webhookDeliveries.targetId, query.targetId));
    const where = and(...conditions);
    const [rows, [totalRow]] = await Promise.all([
      this.db
        .select({
          delivery: webhookDeliveries,
          event: {
            type: webhookEvents.type,
            data: webhookEvents.data,
            occurredAt: webhookEvents.occurredAt,
          },
        })
        .from(webhookDeliveries)
        .innerJoin(webhookEvents, eq(webhookEvents.id, webhookDeliveries.eventId))
        .where(where)
        .orderBy(desc(webhookDeliveries.createdAt), desc(webhookDeliveries.id))
        .limit(query.limit)
        .offset(query.offset),
      this.db.select({ total: count() }).from(webhookDeliveries).where(where),
    ]);
    return {
      items: rows.map(({ delivery, event }) => ({ ...delivery, event })),
      total: totalRow?.total ?? 0,
    };
  }

  async findDelivery(
    subscriptionId: string,
    deliveryId: string,
  ): Promise<WebhookDeliveryRow | undefined> {
    const [row] = await this.db
      .select()
      .from(webhookDeliveries)
      .where(
        and(
          eq(webhookDeliveries.id, deliveryId),
          eq(webhookDeliveries.subscriptionId, subscriptionId),
        ),
      );
    return row;
  }

  async findDeliveryWithEvent(id: string): Promise<WebhookDeliveryWithEvent | undefined> {
    const [row] = await this.db
      .select({
        delivery: webhookDeliveries,
        event: {
          type: webhookEvents.type,
          data: webhookEvents.data,
          occurredAt: webhookEvents.occurredAt,
        },
      })
      .from(webhookDeliveries)
      .innerJoin(webhookEvents, eq(webhookEvents.id, webhookDeliveries.eventId))
      .where(eq(webhookDeliveries.id, id));
    return row ? { ...row.delivery, event: row.event } : undefined;
  }
}
