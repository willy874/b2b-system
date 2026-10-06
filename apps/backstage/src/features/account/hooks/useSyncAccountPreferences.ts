import { useHasSession } from '@b2b-system/web-core/auth';
import { applyAccountPreferences } from '@b2b-system/web-core/store';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import { getAuthProfileQueryOptions } from '@/apis/auth/get-profile/query';

/**
 * 帳號存的語系與時區套用到這台裝置（以帳號為準，docs/architecture/frontend/08-i18n.md §1）。
 * 與權限水合用同一個 profile query（共用快取，不會多打一次）；掛在 app/App.tsx，整個 app 只有一個實例。
 *
 * 只在帳號的值 **改變** 時套用：使用者剛在本機切換、同步帳號的 PATCH 還沒完成時，
 * 期間重取到的舊 profile 不會把畫面切回去；PATCH 成功後 profile 帶回新值，與本機相同，不必再動。
 */
export function useSyncAccountPreferences(): void {
  const hasSession = useHasSession();
  const { data } = useQuery({ ...getAuthProfileQueryOptions(), enabled: hasSession });
  const preferences = data?.user.preferences;
  const applied = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!preferences) return;
    const key = `${preferences.locale}|${preferences.timezone}`;
    if (applied.current === key) return;
    applied.current = key;
    applyAccountPreferences(preferences);
  }, [preferences]);
}
