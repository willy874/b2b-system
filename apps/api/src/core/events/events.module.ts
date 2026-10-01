import { Global, Module } from '@nestjs/common';

import { DomainEventBus } from './event-bus';
import { DomainEventRelay } from './event-relay';

@Global()
@Module({
  // 轉送不被任何人注入：它在 onModuleInit 自己訂閱 bus 與廣播頻道
  providers: [DomainEventBus, DomainEventRelay],
  exports: [DomainEventBus],
})
export class EventsModule {}
