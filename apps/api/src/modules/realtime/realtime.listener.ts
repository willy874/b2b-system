import { ServerEvent } from '@game-editor/realtime';
import type { ResourceChanged } from '@game-editor/realtime';
import { Injectable, Logger } from '@nestjs/common';
import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';

import { DomainEvent, DomainEventBus } from '@/core/events';
import type { DomainEventMeta, DomainEventPayloads } from '@/core/events';

import { RealtimeAudience, resolveAudienceRooms } from './realtime.audience';
import { RealtimeGateway } from './realtime.gateway';
import { userRoom } from './realtime.rooms';

/**
 * 領域事件 → Socket.io（docs/architecture/backend/08-realtime.md §3.5、§6.2、§7）。
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
    private readonly gateway: RealtimeGateway,
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
    const io = this.gateway.server;
    if (!io || !userIds.length) return;
    await this.audience.refreshAudience(io, userIds);
  }

  /** 依來源 → 受眾表推播；`origin` 讓發起的分頁略過（§6.1、§7.1）。 */
  onResourceChanged(
    { changes, affectedUserIds }: DomainEventPayloads[typeof DomainEvent.RESOURCE_CHANGED],
    meta: DomainEventMeta,
  ): void {
    const io = this.gateway.server;
    if (!io || !changes.length) return;

    const rooms = resolveAudienceRooms(changes, affectedUserIds);
    // Socket.io 的 `to([])` 會廣播給「所有」連線；沒有受眾就不推（原則 4：只推給看得到的人）
    if (!rooms.length) return;
    const payload: ResourceChanged = meta.clientId
      ? { changes, origin: meta.clientId }
      : { changes };
    io.to(rooms).emit(ServerEvent.RESOURCE_CHANGED, payload);

    this.logger.debug(
      { resources: changes.map((c) => `${c.resource}.${c.kind}`), rooms: rooms.length },
      '推播資源變更',
    );
  }

  /** 推 `session.revoked` 並斷掉這些使用者的所有連線（§3.5）。 */
  onSessionsRevoked({
    userIds,
    reason,
  }: DomainEventPayloads[typeof DomainEvent.SESSIONS_REVOKED]): void {
    const io = this.gateway.server;
    if (!io) return;
    for (const userId of new Set(userIds)) {
      const room = userRoom(userId);
      const sockets = io.sockets.adapter.rooms.get(room)?.size ?? 0;
      if (!sockets) continue;
      io.to(room).emit(ServerEvent.SESSION_REVOKED, { reason });
      // engine.io 會等寫入緩衝送完才關閉，所以上面那則事件會先送到
      io.in(room).disconnectSockets(true);
      this.logger.log({ userId, reason, sockets }, '撤銷即時連線');
    }
  }
}
