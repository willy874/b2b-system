import type { QueryClient } from '@tanstack/react-query';

import type { AppPluginFactory } from '@/core/app';
import { initInvalidateChannel, queryClient } from '@/core/cache';
import { createDictStorage } from '@/shared/storage';
import type { DictStorage } from '@/shared/storage';

export function cachePlugin(): AppPluginFactory {
  const dictStorage = createDictStorage('cache');

  return () => {
    let closeChannel: (() => void) | undefined;
    return {
      name: 'cache',
      attrs: { queryClient, dictStorage },
      onInit: () => {
        closeChannel = initInvalidateChannel();
      },
      onDestroy: () => closeChannel?.(),
    };
  };
}

declare module '@/core/app/context' {
  interface AppPluginProperties {
    queryClient: QueryClient;
    dictStorage: DictStorage;
  }
}
