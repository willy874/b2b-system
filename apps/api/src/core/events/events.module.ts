import { Global, Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';

import { DomainEventBus } from './event-bus';
import { DOMAIN_EVENT_RELAY_OPTIONS, DomainEventRelay } from './event-relay';
import type { DomainEventRelayOptions } from './event-relay';

@Global()
@Module({
  // 轉送不被任何人注入：它在 onModuleInit 自己訂閱 bus 與廣播頻道
  providers: [DomainEventBus, DomainEventRelay],
  exports: [DomainEventBus],
})
export class EventsModule {
  /**
   * 只把本機的推播類事件轉送出去、不收其他程序轉送來的（不 `LISTEN`）：給沒有推播的程序（對外 API）。
   * 收到的事件只交給 `{ remote: true }` 的訂閱者，這樣的程序沒有任何一個（docs/architecture/backend/08-realtime.md §7.6）。
   */
  static sendOnly(): DynamicModule {
    const options: DomainEventRelayOptions = { receive: false };
    return {
      module: EventsModule,
      providers: [{ provide: DOMAIN_EVENT_RELAY_OPTIONS, useValue: options }],
    };
  }
}
