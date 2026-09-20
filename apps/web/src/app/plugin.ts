import { createRouter } from '@tanstack/react-router';

import type { AppPluginFactory } from '@/core/app';
import { queryClient } from '@/core/cache';

import { routeTree } from './routes';

function createAppRouter() {
  return createRouter({
    routeTree,
    context: { queryClient },
    defaultPreload: 'intent',
    defaultPendingMs: 200,
  });
}

export type AppRouter = ReturnType<typeof createAppRouter>;

/** 最後一個 plugin：此時所有 feature 的 route 物件都已存在。 */
export function appContextPlugin(): AppPluginFactory {
  return () => ({ name: 'app', attrs: { router: createAppRouter() } });
}

declare module '@/core/app/context' {
  interface AppPluginProperties {
    router: AppRouter;
  }
}

declare module '@tanstack/react-router' {
  interface Register {
    router: AppRouter;
  }
}
