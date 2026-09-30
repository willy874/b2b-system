import type { AppPluginFactory } from '@/core/app';
import { queryClient } from '@/core/cache';
import type { AppQueryClient } from '@/core/cache';
import { createDictStorage } from '@/shared/storage';
import type { DictStorage } from '@/shared/storage';

export function cachePlugin(): AppPluginFactory {
  const dictStorage = createDictStorage('cache');

  return () => ({
    name: 'cache',
    attrs: { queryClient, dictStorage },
    onInit: () => queryClient.start(),
    // 模組層級的單例：只停止收訊，不關閉頻道，app 重新建立時還能再 start()
    onDestroy: () => queryClient.stop(),
  });
}

declare module '@/core/app/context' {
  interface AppPluginProperties {
    queryClient: AppQueryClient;
    dictStorage: DictStorage;
  }
}
