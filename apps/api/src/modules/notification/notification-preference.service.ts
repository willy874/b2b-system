import { ChangeKind, ChangeSource } from '@b2b-system/realtime';
import { Inject, Injectable } from '@nestjs/common';

import type { AuthUser } from '@/common/types';
import { TENANT_DB, withTransaction } from '@/core/database';
import type { Database } from '@/core/database';
import { AppException } from '@/core/errors';
import { DomainEvent, DomainEventBus } from '@/core/events';

import type {
  NotificationPreferenceChannelDto,
  NotificationPreferenceListDto,
  NotificationPreferenceLock,
  UpdateNotificationPreferencesDto,
} from './dto/notification-preference.dto';
import { NotificationEventCatalog } from './notification-event.catalog';
import { isVisibleEvent, NotificationPolicyService } from './notification-policy.service';
import type { TenantPolicy } from './notification-policy.service';
import { NotificationPreferenceRepository } from './notification-preference.repository';
import type { AnyNotificationType, NotificationChannel } from './notification.definition';

/** 覆寫值的 Map key（只在本檔使用）。 */
function preferenceKey(type: string, channel: string): string {
  return `${type} ${channel}`;
}

/** 不能調整的原因；`null` 是可以調整（ADR-0028 D14）。 */
function lockOf(
  kind: AnyNotificationType,
  policy: TenantPolicy,
): NotificationPreferenceLock | null {
  if (kind.mandatory) return 'mandatory';
  if (!policy.enabled) return 'tenantDisabled';
  if (!policy.allowUserOverride) return 'tenantRequired';
  return null;
}

interface PreferenceChange {
  type: string;
  channel: NotificationChannel;
  /** `null`：刪掉覆寫值（跟著租戶）。 */
  next: boolean | null;
}

/**
 * 個人的通知設定（docs/architecture/backend/16-notification-event.md §5、ADR-0028 D14、D15）。
 * 只能在租戶允許的範圍內 **少收**：租戶關掉的打不開、租戶要求的關不掉。送達時的判斷在
 * `NotificationPolicyService.filterRecipients()`。是使用者自己的狀態，不寫稽核（與已讀、個人資料相同）。
 */
@Injectable()
export class NotificationPreferenceService {
  constructor(
    @Inject(TENANT_DB) private readonly db: Database,
    private readonly repo: NotificationPreferenceRepository,
    private readonly policy: NotificationPolicyService,
    private readonly catalog: NotificationEventCatalog,
    private readonly events: DomainEventBus,
  ) {}

  /** 自己的設定：目前租戶看得到的事件（目錄的順序）與每個管道的生效值、能不能調整。 */
  async list(actor: AuthUser): Promise<NotificationPreferenceListDto> {
    const stored = await this.stored(actor.id);
    const items = [];
    for (const kind of this.catalog.list().filter(isVisibleEvent)) {
      const channels: NotificationPreferenceChannelDto[] = [];
      for (const channel of kind.channels) {
        // oxlint-disable-next-line no-await-in-loop -- 租戶政策走快取，第一次之後都是記憶體查詢
        const policy = await this.policy.tenantPolicy(kind.type, channel);
        const lock = lockOf(kind, policy);
        const own = stored.get(preferenceKey(kind.type, channel));
        channels.push({
          channel,
          enabled: lock === null ? (own ?? policy.enabled) : policy.enabled,
          // 被鎖住時自己的覆寫不生效：顯示成沒有覆寫（租戶再開放時恢復）
          isOverridden: lock === null && own !== undefined,
          lock,
        });
      }
      items.push({ type: kind.type, category: kind.category, channels });
    }
    return { items };
  }

  /**
   * 一次改多個「事件 ＋ 管道」，全部通過驗證才寫入；與目前相同的略過。
   * 不能調整的項目回 `409 NOTIFICATION_PREFERENCE_LOCKED`；還原（`null`）不論是否鎖住都可以。
   * 推給自己的其他分頁與裝置（`notificationPreference update`）。
   */
  async update(
    dto: UpdateNotificationPreferencesDto,
    actor: AuthUser,
  ): Promise<NotificationPreferenceListDto> {
    const stored = await this.stored(actor.id);
    const changes: PreferenceChange[] = [];
    for (const change of dto.changes) {
      // oxlint-disable-next-line no-await-in-loop -- 租戶政策走快取
      const next = await this.toChange(change, stored);
      if (next) changes.push(next);
    }
    if (!changes.length) return this.list(actor);

    await withTransaction(this.db, async (tx) => {
      // 同一條交易連線上的查詢本來就是依序執行
      for (const change of changes) {
        // oxlint-disable-next-line no-await-in-loop -- 見上
        if (change.next === null) await this.repo.remove(actor.id, change.type, change.channel, tx);
        // oxlint-disable-next-line no-await-in-loop -- 見上
        else await this.repo.upsert(actor.id, change.type, change.channel, change.next, tx);
      }
    });

    this.events.publish(DomainEvent.RESOURCE_CHANGED, {
      changes: [...new Set(changes.map((change) => change.type))].map((type) => ({
        resource: ChangeSource.NOTIFICATION_PREFERENCE,
        kind: ChangeKind.UPDATE,
        id: type,
      })),
      affectedUserIds: [actor.id],
    });
    return this.list(actor);
  }

  // ── 內部 ─────────────────────────────────────────────

  private async stored(userId: string): Promise<Map<string, boolean>> {
    return new Map(
      (await this.repo.listByUser(userId)).map((row) => [
        preferenceKey(row.type, row.channel),
        row.enabled,
      ]),
    );
  }

  /** 驗證一筆修改；與目前相同時回傳 `undefined`。 */
  private async toChange(
    change: UpdateNotificationPreferencesDto['changes'][number],
    stored: Map<string, boolean>,
  ): Promise<PreferenceChange | undefined> {
    const { type, channel, enabled } = change;
    const kind = this.catalog.find(type);
    if (!kind || !isVisibleEvent(kind) || !kind.channels.includes(channel)) {
      throw new AppException('NOTIFICATION_EVENT_NOT_FOUND', { type, channel });
    }
    const isOverridden = stored.has(preferenceKey(type, channel));
    if (enabled === null) return isOverridden ? { type, channel, next: null } : undefined;

    const policy = await this.policy.tenantPolicy(type, channel);
    const lock = lockOf(kind, policy);
    if (lock) throw new AppException('NOTIFICATION_PREFERENCE_LOCKED', { type, channel, lock });
    // 與租戶的生效值相同就不存：跟著租戶，之後租戶改了才跟得上
    const next = enabled === policy.enabled ? null : enabled;
    if (next === null) return isOverridden ? { type, channel, next: null } : undefined;
    return stored.get(preferenceKey(type, channel)) === next ? undefined : { type, channel, next };
  }
}
