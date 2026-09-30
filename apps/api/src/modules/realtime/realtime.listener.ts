import { ServerEvent } from '@b2b-system/realtime';
import type { ResourceChanged } from '@b2b-system/realtime';
import { Injectable, Logger } from '@nestjs/common';
import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';

import { DomainEvent, DomainEventBus } from '@/core/events';
import type { DomainEventMeta, DomainEventPayloads } from '@/core/events';

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
      this.bus.subscribe(DomainEvent.PERMISSIONS_CHANGED, (payload) =>
        this.onPermissionsChanged(payload),
      ),
      this.bus.subscribe(DomainEvent.RESOURCE_CHANGED, (payload, meta) =>
        this.onResourceChanged(payload, meta),
      ),
      this.bus.subscribe(DomainEvent.SESSIONS_REVOKED, (payload) =>
        this.onSessionsRevoked(payload),
      ),
    ];
  }

  onModuleDestroy(): void {
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    this.unsubscribers = [];
  }

  /** 權限集合改變的人換 room（§6.2）。權限快取在發佈前已失效。 */
  async onPermissionsChanged({
    userIds,
  }: DomainEventPayloads[typeof DomainEvent.PERMISSIONS_CHANGED]): Promise<void> {
    if (!userIds.length) return;
    await this.audience.refreshAudience(userIds);
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
}
