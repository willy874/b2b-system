import { ChangeKind, ChangeSource, MAX_CHANGES_PER_EVENT } from '@b2b-system/realtime';
import type { ResourceChangeWire } from '@b2b-system/realtime';
import { Injectable, Logger } from '@nestjs/common';

import type { AuthUser } from '@/common/types';
import { afterCommit } from '@/core/database';
import type { Transaction } from '@/core/database';
import { AppException } from '@/core/errors';
import { DomainEvent, DomainEventBus } from '@/core/events';
import { SettingService } from '@/core/settings';

import type {
  ListAllNotificationDto,
  ListNotificationDto,
  NotificationDto,
  NotificationOverviewPageDto,
  NotificationPageDto,
} from './dto/notification.dto';
import { NotificationPolicyService } from './notification-policy.service';
import { prepareNotifications } from './notification.batch';
import {
  MAX_NOTIFICATION_RECIPIENTS,
  NOTIFICATION_CLEANUP_BATCH_SIZE,
} from './notification.constants';
import { decodeNotificationCursor, encodeNotificationCursor } from './notification.cursor';
import type { NotificationCursor } from './notification.cursor';
import { NotificationChannel } from './notification.definition';
import type { AnyNotificationType, NotificationInput } from './notification.definition';
import { NotificationRepository } from './notification.repository';
import type { NotificationWithActor } from './notification.repository';
import {
  NOTIFICATION_MAX_PER_USER_SETTING,
  NOTIFICATION_RETENTION_DAYS_SETTING,
} from './notification.settings';

const DAY_MS = 24 * 60 * 60 * 1000;

/** 一輪保留清理的結果（存成背景工作的 `output`）。 */
export interface NotificationCleanupReport {
  retentionDays: number;
  maxPerUser: number;
  /** 早於它就已讀的通知被刪除。 */
  cutoff: string;
  deletedRead: number;
  deletedBeyondLimit: number;
}

function toDto(row: NotificationWithActor): NotificationDto {
  return {
    id: row.id,
    type: row.type,
    params: row.params,
    link: row.link ?? null,
    actor: row.actor,
    readAt: row.readAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** 游標格式不對回 `400 VALIDATION_FAILED`（`details.field: 'cursor'`）。 */
function parseCursor(raw: string | undefined): NotificationCursor | undefined {
  if (!raw) return undefined;
  const cursor = decodeNotificationCursor(raw);
  if (!cursor) throw new AppException('VALIDATION_FAILED', { field: 'cursor' });
  return cursor;
}

/** 滿一頁才有下一頁；游標用資料庫格式化的微秒精度時間（`lastCreatedAt`）。 */
function nextCursorOf(
  items: readonly NotificationWithActor[],
  lastCreatedAt: string | undefined,
  limit: number,
): string | null {
  const last = items.at(-1);
  if (!last || items.length !== limit) return null;
  return encodeNotificationCursor({
    createdAt: lastCreatedAt ?? last.createdAt.toISOString(),
    id: last.id,
  });
}

/** 同一位收件人的通知 id → 推播的變更；太多時改推一筆不帶 id 的（前端一樣讓 notification 的 query 失效）。 */
function changesFor(ids: readonly string[], kind: ChangeKind): ResourceChangeWire[] {
  if (ids.length > MAX_CHANGES_PER_EVENT) return [{ resource: ChangeSource.NOTIFICATION, kind }];
  return ids.map((id) => ({ resource: ChangeSource.NOTIFICATION, kind, id }));
}

/**
 * 站內通知（docs/architecture/backend/15-notification.md、docs/architecture/backend/15-notification.md §12）。通用模組：不 import 任何業務模組，
 * 通知類型、參數與收件人都由擁有者模組決定，並在自己的業務交易內呼叫 `notify()`（D2）。
 * 看自己的通知只需要登入；已讀與清除不寫稽核（D9）。
 */
@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    private readonly repo: NotificationRepository,
    private readonly events: DomainEventBus,
    private readonly settings: SettingService,
    private readonly policy: NotificationPolicyService,
  ) {}

  /**
   * 在 **業務的交易內** 寫入通知（與稽核同一條規則：業務寫入成功，通知就一定在；rollback 時一起消失）。
   * 操作者就是收件人的略過（D7）；同一類型同一位收件人只寫一筆；超過 1000 位收件人記 warn 並截斷（D6）。
   * 交易提交後才推播給每位收件人的 user room（D8），payload 只有通知 id。
   *
   * 租戶關掉這個事件的站內通知、或收件人自己關掉（租戶允許時）的不寫（docs/architecture/backend/16-notification-event.md §9.2 D6、D14）；
   * 類型沒有登記進事件目錄是程式錯誤，拋 `Error`。
   *
   * `tx` 必須是 `withTransaction` 開的交易（要登記提交後的推播）。回傳寫入的通知 id。
   */
  async notify(
    input: NotificationInput | readonly NotificationInput[],
    tx: Transaction,
  ): Promise<string[]> {
    const inputs: readonly NotificationInput[] = Array.isArray(input) ? input : [input];
    const prepared = prepareNotifications(inputs, MAX_NOTIFICATION_RECIPIENTS);
    const { truncated } = prepared;
    // 類型取自原始輸入：全部被略過（操作者自己）的類型也要檢查有沒有登記
    const rows = await this.deliverable(prepared.rows, new Set(inputs.map((row) => row.type)), tx);
    if (truncated) {
      this.logger.warn(
        { types: [...new Set(rows.map((row) => row.type))], kept: rows.length, truncated },
        `通知收件人超過上限 ${MAX_NOTIFICATION_RECIPIENTS}，超過的部分不寫入`,
      );
    }
    if (rows.length === 0) return [];

    const inserted = await this.repo.insertMany(rows, tx);
    afterCommit(tx, () => this.publishChanges(inserted, ChangeKind.CREATE));
    return inserted.map((row) => row.id);
  }

  /**
   * 租戶層：這個事件在 `channel` 上要不要送出（docs/architecture/backend/16-notification-event.md §9.2 D6）。收件人沒有帳號時用（例：匿名的註冊申請的結果信）；
   * 有帳號的收件人用 `filterRecipients()`，才會套用個人設定。
   */
  async isChannelEnabled(
    kind: AnyNotificationType,
    channel: NotificationChannel,
    tx?: Transaction,
  ): Promise<boolean> {
    return this.policy.isEnabled(kind.type, channel, tx);
  }

  /**
   * 這些收件人裡要送給誰（租戶層 ＋ 個人設定，docs/architecture/backend/16-notification-event.md §9.2 D14）。站內通知由 `notify()` 自己判斷；
   * 寄信由擁有者在 **入列前** 呼叫，判斷的是入列當下的設定，已入列的信不撤回。
   */
  async filterRecipients(
    kind: AnyNotificationType,
    channel: NotificationChannel,
    recipientIds: readonly string[],
    tx?: Transaction,
  ): Promise<string[]> {
    return this.policy.filterRecipients(kind.type, channel, recipientIds, tx);
  }

  /** 自己的通知，新的在前（keyset 分頁）。 */
  async list(query: ListNotificationDto, actor: AuthUser): Promise<NotificationPageDto> {
    const { items, lastCreatedAt } = await this.repo.list(actor.id, {
      unread: query.unread ?? false,
      limit: query.limit,
      after: parseCursor(query.cursor),
    });
    return { items: items.map(toDto), nextCursor: nextCursorOf(items, lastCreatedAt, query.limit) };
  }

  /**
   * 租戶內所有人的通知（總覽，`notification:read`；docs/architecture/backend/19-announcement.md §9.2 D1）。
   * 只讀、不寫稽核（與稽核日誌的列表相同）。
   */
  async listAll(query: ListAllNotificationDto): Promise<NotificationOverviewPageDto> {
    const { items, lastCreatedAt } = await this.repo.listAll(
      {
        type: query.type,
        recipientId: query.recipientId,
        actorId: query.actorId,
        unread: query.unread ?? false,
        from: query.from,
        to: query.to,
      },
      { limit: query.limit, after: parseCursor(query.cursor) },
    );
    return {
      items: items.map((row) => ({ ...toDto(row), recipient: row.recipient })),
      nextCursor: nextCursorOf(items, lastCreatedAt, query.limit),
    };
  }

  async unreadCount(actor: AuthUser): Promise<{ count: number }> {
    return { count: await this.repo.countUnread(actor.id) };
  }

  /**
   * 標為已讀（已經讀過的保留原本的時間）。不是自己的與不存在的一樣回 `404 NOTIFICATION_NOT_FOUND`，
   * 不透露別人的通知是否存在。推給自己的其他裝置與分頁，讓未讀數跟著更新。
   */
  async markRead(id: string, actor: AuthUser): Promise<NotificationDto> {
    if (!(await this.repo.markRead(id, actor.id, new Date()))) {
      throw new AppException('NOTIFICATION_NOT_FOUND');
    }
    const row = await this.repo.findOwn(id, actor.id);
    // 標完之後到讀回之間被清理工作刪掉：結果等同不存在
    if (!row) throw new AppException('NOTIFICATION_NOT_FOUND');
    this.publishRead(actor.id, [
      { resource: ChangeSource.NOTIFICATION, kind: ChangeKind.UPDATE, id },
    ]);
    return toDto(row);
  }

  /** 自己所有未讀的通知標為已讀。 */
  async markAllRead(actor: AuthUser): Promise<{ updated: number }> {
    const updated = await this.repo.markAllRead(actor.id, new Date());
    if (updated > 0) {
      this.publishRead(actor.id, [
        { resource: ChangeSource.NOTIFICATION, kind: ChangeKind.UPDATE },
      ]);
    }
    return { updated };
  }

  // ── 來源（公告的發送紀錄，docs/architecture/backend/19-announcement.md §9.2 D4、D18） ──────────

  /** 每個來源寫了幾則、讀了幾則（發送紀錄的人數與已讀率）。沒有通知的來源回 `{ total: 0, read: 0 }`。 */
  async statsBySources(
    sourceIds: readonly string[],
  ): Promise<Map<string, { total: number; read: number }>> {
    const rows = await this.repo.countBySources(sourceIds);
    const stats = new Map(sourceIds.map((id) => [id, { total: 0, read: 0 }]));
    for (const row of rows) stats.set(row.sourceId, { total: row.total, read: row.read });
    return stats;
  }

  /**
   * 收件人打開這個來源的內容（例：公告全文）時呼叫：有收到才回 true，並把那則通知標為已讀、推給自己的其他分頁。
   * 沒有收到（不是收件人、已被撤回或清除）回 false，由呼叫端回 404。
   */
  async markSourceRead(sourceId: string, recipientId: string): Promise<boolean> {
    const result = await this.repo.markSourceRead(sourceId, recipientId, new Date());
    if (!result) return false;
    if (result.wasUnread) {
      this.publishRead(recipientId, [
        { resource: ChangeSource.NOTIFICATION, kind: ChangeKind.UPDATE, id: result.id },
      ]);
    }
    return true;
  }

  /**
   * 刪除來自這個來源的所有通知（撤回，docs/architecture/backend/19-announcement.md §9.2 D18），回傳刪掉的筆數。每批一條 DELETE（各自提交），
   * 每批刪完推 `delete` 給各自的收件人，未讀數跟著下降。
   */
  async removeBySource(sourceId: string): Promise<number> {
    let removed = 0;
    for (;;) {
      // oxlint-disable-next-line no-await-in-loop -- 分批刪除，下一批要等這一批提交
      const rows = await this.repo.deleteBySource(sourceId, NOTIFICATION_CLEANUP_BATCH_SIZE);
      removed += rows.length;
      this.publishChanges(rows, ChangeKind.DELETE);
      if (rows.length < NOTIFICATION_CLEANUP_BATCH_SIZE) return removed;
    }
  }

  /**
   * 保留清理（D10）：刪除「已讀超過 `notification.retentionDays` 天」與「每人超過 `notification.maxPerUser` 則的最舊通知」。
   * 每批一條 DELETE（各自提交；中途失敗重跑只剩還沒刪的）。刪除不推播：被刪的都是列表最後面的舊通知，
   * 下次重抓就不見了。
   */
  async cleanup(now: Date = new Date()): Promise<NotificationCleanupReport> {
    const [retentionDays, maxPerUser] = await Promise.all([
      this.settings.get(NOTIFICATION_RETENTION_DAYS_SETTING),
      this.settings.get(NOTIFICATION_MAX_PER_USER_SETTING),
    ]);
    const cutoff = new Date(now.getTime() - retentionDays * DAY_MS);
    const deletedRead = await this.deleteInBatches(() =>
      this.repo.deleteReadBefore(cutoff, NOTIFICATION_CLEANUP_BATCH_SIZE),
    );
    const deletedBeyondLimit = await this.deleteInBatches(() =>
      this.repo.deleteBeyondPerRecipient(maxPerUser, NOTIFICATION_CLEANUP_BATCH_SIZE),
    );
    const report = {
      retentionDays,
      maxPerUser,
      cutoff: cutoff.toISOString(),
      deletedRead,
      deletedBeyondLimit,
    };
    this.logger.log(report, '站內通知保留清理完成');
    return report;
  }

  // ── 內部 ─────────────────────────────────────────────

  /**
   * 依租戶與個人設定留下要送的列（保留順序）。`types` 的每一種都要查：沒有登記的在這裡就拋錯，不論它會不會被略過；
   * 每一種類型一次查完所有收件人的個人設定（docs/architecture/backend/16-notification-event.md §9.2 D15）。
   */
  private async deliverable(
    rows: readonly NotificationInput[],
    types: ReadonlySet<string>,
    tx: Transaction,
  ): Promise<NotificationInput[]> {
    const allowed = new Map<string, Set<string>>();
    for (const type of types) {
      const recipientIds = rows.filter((row) => row.type === type).map((row) => row.recipientId);
      // oxlint-disable-next-line no-await-in-loop -- 類型通常只有一種；同一個交易連線上本來就依序執行
      const ids = await this.policy.filterRecipients(
        type,
        NotificationChannel.IN_APP,
        recipientIds,
        tx,
      );
      allowed.set(type, new Set(ids));
    }
    return rows.filter((row) => allowed.get(row.type)?.has(row.recipientId));
  }

  private async deleteInBatches(batch: () => Promise<number>): Promise<number> {
    let deleted = 0;
    for (;;) {
      // oxlint-disable-next-line no-await-in-loop -- 分批刪除，下一批要等這一批提交
      const count = await batch();
      deleted += count;
      if (count < NOTIFICATION_CLEANUP_BATCH_SIZE) return deleted;
    }
  }

  /**
   * 一批通知只發一則事件，帶「收件人 → 他的通知 id」（`perRecipient`）：listener 逐人推到各自的 user room，
   * 通知 id 不給別人看到（D8）。不再每位收件人一則：公告發給上萬人時，每則都要經平台 DB 轉送（docs/architecture/backend/08-realtime.md §7.6），
   * 同一個租戶的其他推播會排在後面。
   */
  private publishChanges(
    rows: ReadonlyArray<{ id: string; recipientId: string }>,
    kind: ChangeKind,
  ): void {
    const byRecipient = new Map<string, string[]>();
    for (const { id, recipientId } of rows) {
      const ids = byRecipient.get(recipientId);
      if (ids) ids.push(id);
      else byRecipient.set(recipientId, [id]);
    }
    if (byRecipient.size === 0) return;
    this.events.publish(DomainEvent.RESOURCE_CHANGED, {
      changes: [],
      perRecipient: [...byRecipient].map(([userId, ids]) => ({
        userId,
        changes: changesFor(ids, kind),
      })),
    });
  }

  private publishRead(userId: string, changes: ResourceChangeWire[]): void {
    this.events.publish(DomainEvent.RESOURCE_CHANGED, { changes, affectedUserIds: [userId] });
  }
}
