import type { AppContext } from '@b2b-system/web-core/app';
import { GlobalProvider, SessionWatcher } from '@b2b-system/web-core/shell';
import { RouterProvider } from '@tanstack/react-router';

import { AUTH_PROFILE_QUERY_KEY } from '@/apis/auth/get-profile/query';
import { useSyncPermissions } from '@/features/auth';

import { useSyncFeatures } from './features';
import { isPublic, loginSearchAfterSessionEnd } from './sessionRedirect';

/** 整個 app 只有一個權限水合實例；可啟用 feature 的清單跟著同一個 profile 走。 */
function ProfileSync() {
  useSyncPermissions();
  useSyncFeatures();
  return null;
}

export function App({ context }: { context: AppContext }) {
  return (
    <GlobalProvider context={context} profileQueryKey={AUTH_PROFILE_QUERY_KEY}>
      {/* session 結束的去向與清除（兩個 app 共用，web-core/shell） */}
      <SessionWatcher
        router={context.router}
        loginPath="/auth/login"
        isPublic={isPublic}
        loginSearchAfterSessionEnd={loginSearchAfterSessionEnd}
      />
      <ProfileSync />
      <RouterProvider router={context.router} />
    </GlobalProvider>
  );
}
