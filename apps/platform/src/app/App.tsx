import type { AppContext } from '@b2b-system/web-core/app';
import { DocumentTitle, GlobalProvider, SessionWatcher } from '@b2b-system/web-core/shell';
import { useTelemetryUser } from '@b2b-system/web-core/telemetry';
import { RouterProvider } from '@tanstack/react-router';

import { AUTH_PROFILE_QUERY_KEY } from '@/apis/auth/get-profile/query';
import { useSyncPermissions } from '@/features/login';

import { isPublic } from './sessionRedirect';

/** 整個 app 只有一個權限水合實例；錯誤回報的使用者 id 跟著同一個 profile 走。 */
function ProfileSync() {
  const { profile } = useSyncPermissions();
  useTelemetryUser(profile?.admin.id);
  return null;
}

export function App({ context }: { context: AppContext }) {
  return (
    <GlobalProvider context={context} profileQueryKey={AUTH_PROFILE_QUERY_KEY}>
      {/* session 結束的去向與清除（兩個 app 共用，web-core/shell） */}
      <SessionWatcher router={context.router} loginPath="/login" isPublic={isPublic} />
      {/* 「頁面 · 產品名」，跟著換頁與語系（路由的 staticData.titleKey） */}
      <DocumentTitle router={context.router} appNameKey="app.documentTitle" />
      <ProfileSync />
      <RouterProvider router={context.router} />
    </GlobalProvider>
  );
}
