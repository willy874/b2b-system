import { Inject, Injectable } from '@nestjs/common';
import { and, arrayContains, count, desc, eq, ilike, inArray, lt, or, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';

import type { Database, DbOrTx } from '@/core/database';
import { containsPattern, TENANT_DB } from '@/core/database';
import { users, webhookDeliveries, webhookEvents, webhookSubscriptions } from '@/db/schema';
import type {
  WebhookDeliveryRow,
  WebhookEventRow,
  WebhookSubscriptionInsert,
  WebhookSubscriptionRow,
} from '@/db/schema';

import type { ListWebhookDeliveryDto, ListWebhookDto } from './dto/webhook.dto';

export interface WebhookSubscriptionWithCreator extends WebhookSubscriptionRow {
  creator: { id: string; displayName: string } | null;
}

export interface WebhookDeliveryWithEvent extends WebhookDeliveryRow {
  event: Pick<WebhookEventRow, 'type' | 'data' | 'occurredAt'>;
}

export interface NewWebhookDelivery {
  subscriptionId: string;
  eventId: string;
  attempt: number;
  trigger: 'auto' | 'manual';
  succeeded: boolean;
  responseStatus: number | null;
  durationMs: number;
  responseBody: string | null;
  error: string | null;
}

/** 投遞失敗後的訂閱狀態：`disabledNow` = 這一次讓它到達門檻而停用。 */
export interface FailureResult {
  consecutiveFailures: number;
  disabledNow: boolean;
}

const CREATOR = sql<{ id: string; displayName: string } | null>`
  CASE WHEN ${users.id} IS NULL THEN NULL
  ELSE json_build_object('id', ${users.id}, 'displayName', ${users.displayName}) END`;

/** Webhook 的訂閱、事件與投遞紀錄（docs/adr/0030-webhooks.md D7、D9、D12）。 */
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
        ilike(webhookSubscriptions.url, pattern),
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
    return {
      items: rows.map(({ subscription, creator }) => ({ ...subscription, creator })),
      total: totalRow?.total ?? 0,
    };
  }

  async findById(id: string, tx?: DbOrTx): Promise<WebhookSubscriptionWithCreator | undefined> {
    const [row] = await (tx ?? this.db)
      .select({ subscription: webhookSubscriptions, creator: CREATOR })
      .from(webhookSubscriptions)
      .leftJoin(users, eq(users.id, webhookSubscriptions.createdBy))
      .where(eq(webhookSubscriptions.id, id));
    return row ? { ...row.subscription, creator: row.creator } : undefined;
  }

  async countAll(tx?: DbOrTx): Promise<number> {
    const [row] = await (tx ?? this.db).select({ total: count() }).from(webhookSubscriptions);
    return row?.total ?? 0;
  }

  /** 建立前鎖住整張表的計數：同時建立兩個不會一起超過上限。 */
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

  /** 訂閱了這個事件的啟用中訂閱（`emit()` 在業務交易內呼叫；走部分 GIN 索引）。 */
  async findActiveIdsByEvent(type: string, tx: DbOrTx): Promise<string[]> {
    const rows = await tx
      .select({ id: webhookSubscriptions.id })
      .from(webhookSubscriptions)
      .where(
        and(
          eq(webhookSubscriptions.status, 'active'),
          arrayContains(webhookSubscriptions.events, [type]),
        ),
      );
    return rows.map((row) => row.id);
  }

  /** 投遞成功：失敗次數歸零。不改 `version`（系統寫入）。 */
  async recordSuccess(id: string, at: Date, tx?: DbOrTx): Promise<void> {
    await (tx ?? this.db)
      .update(webhookSubscriptions)
      .set({ consecutiveFailures: 0, lastDeliveryAt: at })
      .where(eq(webhookSubscriptions.id, id));
  }

  /**
   * 投遞失敗：失敗次數加一；到門檻且仍是啟用中就停用（`disabled_reason = 'failing'`，D13）。
   * 一條 UPDATE 完成，兩個並行的失敗不會都以為自己是讓它停用的那一次。
   */
  async recordFailure(
    id: string,
    at: Date,
    threshold: number,
    tx: DbOrTx,
  ): Promise<FailureResult | undefined> {
    const next = sql`${webhookSubscriptions.consecutiveFailures} + 1`;
    const reaches = sql`${next} >= ${threshold} AND ${webhookSubscriptions.status} = 'active'`;
    const [row] = await tx
      .update(webhookSubscriptions)
      .set({
        consecutiveFailures: next,
        lastDeliveryAt: at,
        status: sql`CASE WHEN ${reaches} THEN 'disabled' ELSE ${webhookSubscriptions.status} END`,
        disabledReason: sql`CASE WHEN ${reaches} THEN 'failing' ELSE ${webhookSubscriptions.disabledReason} END`,
        version: sql`CASE WHEN ${reaches} THEN ${webhookSubscriptions.version} + 1 ELSE ${webhookSubscriptions.version} END`,
      })
      .where(eq(webhookSubscriptions.id, id))
      .returning({
        consecutiveFailures: webhookSubscriptions.consecutiveFailures,
        status: webhookSubscriptions.status,
        disabledReason: webhookSubscriptions.disabledReason,
      });
    if (!row) return undefined;
    return {
      consecutiveFailures: row.consecutiveFailures,
      // 剛好等於門檻、而且這次改成了 failing：之前已停用的不會再進來（條件含 status = 'active'）
      disabledNow:
        row.status === 'disabled' &&
        row.disabledReason === 'failing' &&
        row.consecutiveFailures >= threshold &&
        row.consecutiveFailures - 1 < threshold,
    };
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

  /** 這個事件對這個訂閱已經嘗試過幾次（下一次的 `attempt` = 它 + 1）。 */
  async countAttempts(subscriptionId: string, eventId: string): Promise<number> {
    const [row] = await this.db
      .select({ total: count() })
      .from(webhookDeliveries)
      .where(
        and(
          eq(webhookDeliveries.subscriptionId, subscriptionId),
          eq(webhookDeliveries.eventId, eventId),
        ),
      );
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
