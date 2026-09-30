import { ChangeKind, ChangeSource, ServerEvent } from '@b2b-system/realtime';
import type { ResourceChanged } from '@b2b-system/realtime';
import { Injectable, Logger } from '@nestjs/common';
import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';

import { DomainEvent, DomainEventBus } from '@/core/events';
import type { DomainEventMeta, DomainEventPayloads } from '@/core/events';
import { requireTenant } from '@/core/tenant';

import { RealtimeAudience, resolveAudienceRooms } from './realtime.audience';
import { RealtimePublisher } from './realtime.publisher';
import { idpSessionRoom, tenantRoom, userRoom } from './realtime.rooms';

/**
 * 領域事件 → 推播（docs/architecture/backend/08-realtime.md §3.5、§6.2、§7）。
 * 只經 `RealtimePublisher` 對連線做事，不認識 Socket.io。
 *
 * 業務 service 不認識 realtime，只在交易提交、快取失效之後發佈事件；bus 依發佈順序處理，
 * 所以 `permissions.changed`（同步 room）一定早於同一次操作的 `resource.changed`（推播）。
 * 這裡的錯誤由 bus 記錄並吞掉：推播只是加速，不影響已成功的寫入。
 */
@Injectable()
export class RealtimeListener implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RealtimeListener.name);
  private unsubscribers: Array<() => void> = [];

  constructor(
    private readonly bus: DomainEventBus,
    private readonly publisher: RealtimePublisher,
    private readonly audience: RealtimeAudience,
  ) {}

  onModuleInit(): void {
    this.unsubscribers = [
      this.bus.subscribe(DomainEvent.PERMISSIONS_CHANGED, () => this.onPermissionsChanged()),
      this.bus.subscribe(DomainEvent.RESOURCE_CHANGED, (payload, meta) =>
        this.onResourceChanged(payload, meta),
      ),
      this.bus.subscribe(DomainEvent.SESSIONS_REVOKED, (payload) =>
        this.onSessionsRevoked(payload),
      ),
      this.bus.subscribe(DomainEvent.TENANT_FEATURES_CHANGED, (payload) =>
        this.onTenantFeaturesChanged(payload),
      ),
    ];
  }

  onModuleDestroy(): void {
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    this.unsubscribers = [];
  }

  /**
   * 關係圖變了：這個租戶在本機的所有連線重算 room（§6.2）。事件不帶「受影響的人」——
   * 失效以整個租戶為單位（docs/adr/0024-relationship-based-access-control.md D8），權限快取在發佈前已失效。
   */
  async onPermissionsChanged(): Promise<void> {
    await this.audience.refreshAudience(
      this.publisher.connectedUserIds(tenantRoom(requireTenant().id)),
    );
  }

  /** 依來源 → 受眾表推播；`origin` 讓發起的分頁略過（§6.1、§7.1）。 */
  onResourceChanged(
    { changes, affectedUserIds }: DomainEventPayloads[typeof DomainEvent.RESOURCE_CHANGED],
    meta: DomainEventMeta,
  ): void {
    if (!changes.length) return;

    const rooms = resolveAudienceRooms(changes, affectedUserIds);
    // 沒有受眾就不推（原則 4：只推給看得到的人）
    if (!rooms.length) return;
    const payload: ResourceChanged = meta.clientId
      ? { changes, origin: meta.clientId }
      : { changes };
    this.publisher.emit(rooms, ServerEvent.RESOURCE_CHANGED, payload);

    this.logger.debug(
      { resources: changes.map((c) => `${c.resource}.${c.kind}`), rooms: rooms.length },
      '推播資源變更',
    );
  }

  /** 推 `session.revoked` 並斷掉這些使用者的所有連線（§3.5）。 */
  onSessionsRevoked({
    userIds = [],
    idpSessionUids = [],
    tenantIds = [],
    reason,
  }: DomainEventPayloads[typeof DomainEvent.SESSIONS_REVOKED]): void {
    const rooms = [
      ...[...new Set(userIds)].map(userRoom),
      // 單一登出：只有同一個 IdP session 的連線，同一個人的其他裝置不受影響（ADR-0019 D5）
      ...[...new Set(idpSessionUids)].map(idpSessionRoom),
      ...[...new Set(tenantIds)].map(tenantRoom),
    ];
    for (const room of rooms) {
      const sockets = this.publisher.countConnections(room);
      if (!sockets) continue;
      this.publisher.emit(room, ServerEvent.SESSION_REVOKED, { reason });
      // publisher 保證斷線前已 emit 的事件會先送到
      this.publisher.disconnect(room);
      this.logger.log({ room, reason, sockets }, '撤銷即時連線');
    }
  }

  /**
   * 租戶啟用的 feature 變了（docs/adr/0021-runtime-feature-activation.md D8）：推給這個租戶的 **所有** 連線，
   * 每個人都要重新取得 profile。事件在平台的請求裡發佈（沒有租戶脈絡），所以 room 以 `tenantId` 組，
   * 與停用租戶時撤銷連線的做法相同；也沒有 `origin`——發起的平台管理者不在租戶的連線裡。
   */
  onTenantFeaturesChanged({
    tenantId,
  }: DomainEventPayloads[typeof DomainEvent.TENANT_FEATURES_CHANGED]): void {
    // 不先以 countConnections 略過：它只看本機的連線，裝了跨節點 adapter 之後會漏推（08-realtime.md §10.3）
    const room = tenantRoom(tenantId);
    const payload: ResourceChanged = {
      changes: [{ resource: ChangeSource.TENANT_FEATURE, kind: ChangeKind.UPDATE }],
    };
    this.publisher.emit(room, ServerEvent.RESOURCE_CHANGED, payload);
    this.logger.debug({ room }, '推播租戶的 feature 變更');
  }
}
