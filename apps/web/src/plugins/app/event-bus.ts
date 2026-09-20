import type { AppPluginFactory } from '@/core/app';
import { EventEmitter } from '@/shared/EventEmitter';

export type GlobalEventMap = {
  'user:rolesChanged': (payload: { userId: string }) => void;
  'session:ended': (reason: string) => void;
};

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
