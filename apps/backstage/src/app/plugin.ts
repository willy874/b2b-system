import type { AppPluginFactory } from '@b2b-system/web-core/app';
import { queryClient } from '@b2b-system/web-core/cache';
import { registerCommandPalette } from '@b2b-system/web-core/command-palette';
import { NotFoundPage, PageSkeleton, RouteErrorPage } from '@b2b-system/web-core/components';
import {
  emailMethod,
  lineMethod,
  registerMfaMethod,
  smsMethod,
  telegramMethod,
  totpMethod,
  webauthnMethod,
} from '@b2b-system/web-core/mfa';
import { parseSearch, stringifySearch } from '@b2b-system/web-core/router';
import { createRouter } from '@tanstack/react-router';

import { registerNavGroups } from '@/core/navigation';

import { registerBuiltinHeaderTools } from './layouts/headerTools';
import { routeTree } from './routes';

export function createAppRouter() {
  return createRouter({
    routeTree,
    context: { queryClient },
    defaultPreload: 'intent',
    defaultPendingMs: 200,
    // 路徑分大小寫：頁面權限守衛（Layout 的 usePageAccess）以網址上原樣的路徑比對頁面鍵，
    // router 若不分大小寫，`/USER`、`/User/create` 會命中頁面卻查不到頁面鍵而略過 403（docs/architecture/frontend/04-routing.md §4）
    caseSensitive: true,
    // 未知網址、頁面載入失敗（含部署後舊 chunk 不見）與載入中顯示本地化的頁面，不用框架預設的英文畫面
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
    // 側欄的分類（頁面由各 feature 的 navigation.ts 登記）與命令面板（⌘K、頂列的搜尋按鈕）
    registerNavGroups();
    registerCommandPalette();
    // MFA 的驗證方式（登入互動、帳號設定共用的 UI，docs/architecture/backend/21-mfa.md §11）
    registerMfaMethod(webauthnMethod);
    registerMfaMethod(totpMethod);
    registerMfaMethod(smsMethod);
    registerMfaMethod(telegramMethod);
    registerMfaMethod(lineMethod);
    registerMfaMethod(emailMethod);
    return { name: 'app', attrs: { router: createAppRouter() } };
  };
}

declare module '@b2b-system/web-core/app/context' {
  interface AppPluginProperties {
    router: AppRouter;
  }
}

declare module '@tanstack/react-router' {
  interface Register {
    router: AppRouter;
  }
}
