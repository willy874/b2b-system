import { Global, Module } from '@nestjs/common';

import { DomainEventBus } from './event-bus';

@Global()
@Module({
  providers: [DomainEventBus],
  exports: [DomainEventBus],
})
export class EventsModule {}
