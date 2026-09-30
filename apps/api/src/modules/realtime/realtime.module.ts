import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '@/core/config';
import { PermissionModule } from '@/modules/permission/permission.module';

import { RealtimeAudience } from './realtime.audience';
import { REALTIME_LIMITS, realtimeLimitsOf } from './realtime.constants';
import { RealtimeExpiry } from './realtime.expiry';
import { RealtimeGateway } from './realtime.gateway';
import { RealtimeListener } from './realtime.listener';
import { RealtimePublisher, SocketIoRealtimePublisher } from './realtime.publisher';

/**
 * 只依賴 `PermissionModule`（解析權限集合 → perm room）與 core 的 `DomainEventBus`。
 * 業務模組不 import 它：它們只發佈領域事件，由 `RealtimeListener` 轉成推播
 * （docs/architecture/backend/08-realtime.md §2）。沒有 export 任何 provider。
 */
@Module({
  imports: [PermissionModule],
  providers: [
    RealtimeGateway,
    RealtimeListener,
    RealtimeAudience,
    RealtimeExpiry,
    SocketIoRealtimePublisher,
    { provide: RealtimePublisher, useExisting: SocketIoRealtimePublisher },
    {
      provide: REALTIME_LIMITS,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        realtimeLimitsOf({
          REALTIME_HANDSHAKES_PER_IP: config.get('REALTIME_HANDSHAKES_PER_IP', { infer: true }),
          REALTIME_CONNECTIONS_PER_USER: config.get('REALTIME_CONNECTIONS_PER_USER', {
            infer: true,
          }),
        }),
    },
  ],
})
export class RealtimeModule {}
