import { usePageAccessChecker } from '@b2b-system/web-core/permission';
import { useStore } from '@b2b-system/web-shared/hooks';
import { useMemo } from 'react';

import { systemSettingsTabRegistry } from './registry';
import type { SystemSettingsTab } from './registry';

/** 目前看得到的分頁（有權限、所屬 feature 已啟用），依 `order` 排序；權限未水合前是空陣列。 */
export function useSystemSettingsTabs(): { hydrated: boolean; tabs: SystemSettingsTab[] } {
  const entries = useStore(systemSettingsTabRegistry.store, (state) => state.entries);
  const { hydrated, canAccessPage } = usePageAccessChecker();
  const tabs = useMemo(
    () =>
      hydrated
        ? [...entries.values()]
            .filter((tab) => canAccessPage(tab.pageKey))
            .toSorted((a, b) => a.order - b.order)
        : [],
    [canAccessPage, entries, hydrated],
  );
  return { hydrated, tabs };
}
