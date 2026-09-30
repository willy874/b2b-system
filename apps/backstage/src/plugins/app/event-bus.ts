import type { AppPluginFactory, GlobalEventMap } from '@/core/app';
import { EventEmitter } from '@/shared/EventEmitter';

export function eventBusPlugin(): AppPluginFactory {
  const eventBus = new EventEmitter<GlobalEventMap>();
  return () => ({
    name: 'event-bus',
    attrs: { eventBus },
    onDestroy: () => eventBus.clear(),
  });
}

declare module '@/core/app/context' {
  interface AppPluginProperties {
    eventBus: EventEmitter<GlobalEventMap>;
  }
}
