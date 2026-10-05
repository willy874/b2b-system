import { useStore } from '@b2b-system/web-shared/hooks';
import { useEffect, useMemo } from 'react';

import { loadLocaleScope, useTranslation } from '../locales';
import {
  preferenceSectionRegistry,
  preferenceTableRegistry,
  sortPreferenceSections,
} from './registry';
import type { PreferenceSection, PreferenceTable } from './registry';

/** 偏好頁的分頁（依 `order` 排序）；feature 在執行期安裝或卸載時跟著更新。 */
export function usePreferenceSections(): PreferenceSection[] {
  const entries = useStore(preferenceSectionRegistry.store, (state) => state.entries);
  return useMemo(() => sortPreferenceSections(entries.values()), [entries]);
}

/** feature 登記的列表；feature 在執行期安裝或卸載時跟著更新。 */
export function usePreferenceTables(): PreferenceTable[] {
  const entries = useStore(preferenceTableRegistry.store, (state) => state.entries);
  return useMemo(() => [...entries.values()], [entries]);
}

/**
 * 偏好頁的分頁與列表名稱所在的 scope：依註冊表的目前內容載入。
 * route loader（`preferenceLocaleLoader`）只看得到進頁當下的註冊表；可啟用的 feature（docs/architecture/frontend/02-plugin-system.md §9）晚一步安裝時，
 * 它的列表會出現在偏好頁，語系包則由這裡要求（還沒登記的會在登記時補載）。載完後 `useTranslation` 換新 `t`，畫面跟著更新。
 */
export function usePreferenceLocales(): void {
  const sections = usePreferenceSections();
  const tables = usePreferenceTables();
  const { language } = useTranslation();
  const scopes = useMemo(
    () => [
      ...new Set([
        ...sections.flatMap((section) => section.localeScope ?? []),
        ...tables.flatMap((table) => table.localeScope ?? []),
      ]),
    ],
    [sections, tables],
  );

  useEffect(() => {
    for (const scope of scopes) {
      // 失敗時不記成已載入：畫面暫時顯示 key，下次進頁的 route loader 再試
      loadLocaleScope(scope, language).catch(() => undefined);
    }
  }, [scopes, language]);
}
