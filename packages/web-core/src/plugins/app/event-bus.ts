import { EventEmitter } from '@b2b-system/web-shared/EventEmitter';

import type { AppPluginFactory, GlobalEventMap } from '../../app';

export function eventBusPlugin(): AppPluginFactory {
  const eventBus = new EventEmitter<GlobalEventMap>();
  return () => ({
    name: 'event-bus',
    attrs: { eventBus },
    onDestroy: () => eventBus.clear(),
  });
}

declare module '../../app/context' {
  interface AppPluginProperties {
    eventBus: EventEmitter<GlobalEventMap>;
  }
}
