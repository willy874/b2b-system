import { createDictStorage } from '@b2b-system/web-shared/storage';
import type { DictStorage } from '@b2b-system/web-shared/storage';

import type { AppPluginFactory } from '../../app';
import { queryClient } from '../../cache';
import type { AppQueryClient } from '../../cache';

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

declare module '../../app/context' {
  interface AppPluginProperties {
    queryClient: AppQueryClient;
    dictStorage: DictStorage;
  }
}
