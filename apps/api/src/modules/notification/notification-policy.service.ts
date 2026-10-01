import { ChangeKind, ChangeSource } from '@b2b-system/realtime';
import { Inject, Injectable } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';

import type { AuthUser } from '@/common/types';
import { BroadcastService, parseTenantInvalidation } from '@/core/broadcast';
import type { BroadcastPublisher, TenantInvalidation } from '@/core/broadcast';
import { TENANT_DB, withTransaction } from '@/core/database';
import type { Database, DbOrTx } from '@/core/database';
import { AppException } from '@/core/errors';
import { DomainEvent, DomainEventBus } from '@/core/events';
import { currentTenant } from '@/core/tenant';
import { AuditService } from '@/modules/audit-log/audit.service';

import type {
  NotificationEventDto,
  NotificationEventListDto,
  UpdateNotificationEventsDto,
} from './dto/notification-event.dto';
import { NotificationEventCatalog } from './notification-event.catalog';
import { NotificationPolicyRepository } from './notification-policy.repository';
import type { AnyNotificationType, NotificationChannel } from './notification.definition';

/** 一個「事件 ＋ 管道」的覆寫值。 */
interface StoredPolicy {
  enabled: boolean;
  updatedAt: Date;
}

type StoredPolicies = Map<string, StoredPolicy>;

/**
 * 修改後本程序立即失效、其他程序經廣播失效；TTL 只是保險（直接改了資料庫、漏掉廣播）。
 * 與系統設定相同（docs/architecture/backend/12-settings.md §1）。
 */
const TTL_MS = 30_000;

/** 平台 DB 上的廣播頻道（docs/architecture/01-system.md §4.4）。 */
export const NOTIFICATION_POLICY_CHANNEL = 'notification_policy';

interface Entry {
  rows: StoredPolicies;
  expiresAt: number;
}

interface PolicyChange {
  type: string;
  channel: NotificationChannel;
  /** `null`：還原預設。 */
  next: boolean | null;
  before: boolean;
  after: boolean;
}

/** 覆寫值的 Map key（只在本檔使用；稽核的 key 用 `<type>:<channel>`）。 */
function policyKey(type: string, channel: string): string {
  return `${type} ${channel}`;
}

function auditKey(change: PolicyChange): string {
  return `${change.type}:${change.channel}`;
}

/** 沒有租戶脈絡時（單元測試）歸在同一組，與設定、權限快取相同。 */
function tenantKey(): string {
  return currentTenant()?.id ?? '-';
}

/** 所屬的 feature 沒有啟用就不出現在管理頁（ADR-0028 D11）。沒有租戶脈絡時不判斷（與 `FeatureGuard` 相同）。 */
function isVisible(kind: AnyNotificationType): boolean {
  const tenant = currentTenant();
  return !kind.feature || !tenant || tenant.features.includes(kind.feature);
}

/**
 * 租戶層的通知政策（docs/architecture/backend/16-notification-event.md、ADR-0028）。
 *
 * - 事件與管道的定義在 `NotificationEventCatalog`（程式碼）；資料庫只存覆寫值，讀取走每個租戶一份的快取。
 * - `isEnabled()` 由 `NotificationService.notify()`（站內）與擁有者的寄信入列前（email）呼叫——判斷只有這一處（D6）。
 * - 管理頁的讀寫：驗證、稽核、推播（形狀與 `PATCH /system/settings` 相同，D9）。
 */
@Injectable()
export class NotificationPolicyService implements OnModuleInit {
  private readonly cache = new Map<string, Entry>();
  private publish?: BroadcastPublisher<TenantInvalidation>;

  constructor(
    @Inject(TENANT_DB) private readonly db: Database,
    private readonly repo: NotificationPolicyRepository,
    private readonly catalog: NotificationEventCatalog,
    private readonly audit: AuditService,
    private readonly events: DomainEventBus,
    private readonly broadcast: BroadcastService,
  ) {}

  onModuleInit(): void {
    this.publish = this.broadcast.channel(NOTIFICATION_POLICY_CHANNEL, {
      parse: parseTenantInvalidation,
      onMessage: ({ tenant }) => void this.cache.delete(tenant),
      onReconnect: () => this.cache.clear(),
    });
  }

  /**
   * 這個事件在這個管道上要不要送出：`mandatory` 一律送；否則租戶的覆寫值，沒有覆寫用 `defaultEnabled`。
   * 事件沒有登記或不支援這個管道是呼叫端的程式錯誤，拋 `Error`。
   *
   * 在業務交易內呼叫時傳 `tx`：快取過期要重讀時沿用交易的連線，不在交易進行中另外佔一條。
   */
  async isEnabled(type: string, channel: NotificationChannel, tx?: DbOrTx): Promise<boolean> {
    const kind = this.catalog.get(type);
    if (!kind.channels.includes(channel)) {
      throw new Error(`通知類型 ${type} 不支援管道 ${channel}（defineNotification 的 channels）`);
    }
    if (kind.mandatory) return true;
    return this.effective(kind, channel, await this.stored(tx));
  }

  /** 管理頁：目前租戶看得到的事件（目錄的順序）與每個管道的生效值。 */
  async list(): Promise<NotificationEventListDto> {
    const stored = await this.stored();
    return {
      items: this.catalog
        .list()
        .filter(isVisible)
        .map((kind) => this.toDto(kind, stored)),
    };
  }

  /**
   * 一次改多個「事件 ＋ 管道」，全部通過驗證才寫入；與生效值相同的略過，全部都沒變就不寫稽核、不推播。
   * 一個交易、一筆稽核；交易後失效快取，再推給 `system:read` 的人（ADR-0028 D9）。
   */
  async update(
    dto: UpdateNotificationEventsDto,
    actor: AuthUser,
  ): Promise<NotificationEventListDto> {
    const stored = await this.stored();
    const changes = dto.changes
      .map((change) => this.toChange(change, stored))
      .filter((change): change is PolicyChange => change !== undefined);
    if (!changes.length) return this.list();

    await withTransaction(this.db, async (tx) => {
      // 同一條交易連線上的查詢本來就是依序執行，並行送出只會在 driver 裡排隊
      for (const change of changes) {
        // oxlint-disable-next-line no-await-in-loop -- 見上
        if (change.next === null) await this.repo.remove(change.type, change.channel, tx);
        // oxlint-disable-next-line no-await-in-loop -- 見上
        else await this.repo.upsert(change.type, change.channel, change.next, actor.id, tx);
      }
      await this.audit.record(
        {
          action: 'notificationPolicy.update',
          resourceType: 'notificationPolicy',
          resourceName: changes.map(auditKey).join(', '),
          changes: {
            before: Object.fromEntries(changes.map((change) => [auditKey(change), change.before])),
            after: Object.fromEntries(changes.map((change) => [auditKey(change), change.after])),
          },
        },
        tx,
      );
    });

    this.invalidate();
    this.events.publish(DomainEvent.RESOURCE_CHANGED, {
      changes: [...new Set(changes.map((change) => change.type))].map((type) => ({
        resource: ChangeSource.NOTIFICATION_POLICY,
        kind: ChangeKind.UPDATE,
        id: type,
      })),
    });
    return this.list();
  }

  /** 目前租戶的快取（也通知其他程序）；寫入的交易 **提交後** 呼叫。 */
  invalidate(): void {
    const tenant = tenantKey();
    this.cache.delete(tenant);
    void this.publish?.({ tenant });
  }

  // ── 內部 ─────────────────────────────────────────────

  private async stored(tx?: DbOrTx): Promise<StoredPolicies> {
    const key = tenantKey();
    const entry = this.cache.get(key);
    if (entry && entry.expiresAt > Date.now()) return entry.rows;

    const rows: StoredPolicies = new Map(
      (await this.repo.listAll(tx)).map((row) => [
        policyKey(row.type, row.channel),
        { enabled: row.enabled, updatedAt: row.updatedAt },
      ]),
    );
    this.cache.set(key, { rows, expiresAt: Date.now() + TTL_MS });
    return rows;
  }

  private effective(
    kind: AnyNotificationType,
    channel: NotificationChannel,
    stored: StoredPolicies,
  ): boolean {
    if (kind.mandatory) return true;
    return stored.get(policyKey(kind.type, channel))?.enabled ?? kind.defaultEnabled;
  }

  /** 驗證一筆修改；與目前相同時回傳 `undefined`。 */
  private toChange(
    change: UpdateNotificationEventsDto['changes'][number],
    stored: StoredPolicies,
  ): PolicyChange | undefined {
    const { type, channel, enabled } = change;
    const kind = this.catalog.find(type);
    if (!kind || !isVisible(kind) || !kind.channels.includes(channel)) {
      throw new AppException('NOTIFICATION_EVENT_NOT_FOUND', { type, channel });
    }
    if (kind.mandatory) throw new AppException('NOTIFICATION_EVENT_MANDATORY', { type });

    const before = this.effective(kind, channel, stored);
    if (enabled === null) {
      return stored.has(policyKey(type, channel))
        ? { type, channel, next: null, before, after: kind.defaultEnabled }
        : undefined;
    }
    // 與生效值相同就不寫：沒有覆寫時等於預設值，存一列只會讓之後調整預設值時這個租戶跟不上
    if (enabled === before) return undefined;
    return { type, channel, next: enabled, before, after: enabled };
  }

  private toDto(kind: AnyNotificationType, stored: StoredPolicies): NotificationEventDto {
    return {
      type: kind.type,
      category: kind.category,
      mandatory: kind.mandatory,
      channels: kind.channels.map((channel) => {
        // mandatory 的覆寫值不會生效（也寫不進來）：一律顯示成沒有覆寫
        const row = kind.mandatory ? undefined : stored.get(policyKey(kind.type, channel));
        return {
          channel,
          enabled: this.effective(kind, channel, stored),
          defaultEnabled: kind.defaultEnabled,
          isOverridden: row !== undefined,
          updatedAt: row ? row.updatedAt.toISOString() : null,
        };
      }),
    };
  }
}
