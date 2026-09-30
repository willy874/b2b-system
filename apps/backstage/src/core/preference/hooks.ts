import { useMemo } from 'react';

import { useStore } from '@/shared/hooks';

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
