import { createRouter } from '@tanstack/react-router';

import type { AppPluginFactory } from '@/core/app';
import { queryClient } from '@/core/cache';
import { NotFoundPage, PageSkeleton, RouteErrorPage } from '@/core/components';
import { parseSearch, stringifySearch } from '@/core/router';

import { registerBuiltinHeaderTools } from './layouts/headerTools';
import { routeTree } from './routes';

function createAppRouter() {
  return createRouter({
    routeTree,
    context: { queryClient },
    defaultPreload: 'intent',
    defaultPendingMs: 200,
    // 未知網址、頁面載入失敗（含部署後舊 chunk 不見）與載入中顯示本地化的頁面，不用框架預設的英文畫面（UX-09）
    defaultNotFoundComponent: NotFoundPage,
    defaultErrorComponent: RouteErrorPage,
    defaultPendingComponent: PageSkeleton,
    parseSearch,
    stringifySearch,
  });
}

export type AppRouter = ReturnType<typeof createAppRouter>;

/** 最後一個 plugin：此時所有 feature 的 route 物件都已存在。 */
export function appContextPlugin(): AppPluginFactory {
  return () => {
    // 同步階段：頂列與偏好頁第一次渲染前工具就已存在
    registerBuiltinHeaderTools();
    return { name: 'app', attrs: { router: createAppRouter() } };
  };
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
