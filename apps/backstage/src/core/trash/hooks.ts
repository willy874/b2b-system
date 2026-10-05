import { useStore } from '@b2b-system/web-shared/hooks';
import { useMemo } from 'react';

import { sortTrashTypes, trashTypeRegistry } from './registry';
import type { TrashTypeRegistration } from './registry';

/** 登記的回收桶類型（依 `order` 排序）；feature 在執行期安裝或卸載時跟著更新。 */
export function useTrashTypes(): TrashTypeRegistration[] {
  const entries = useStore(trashTypeRegistry.store, (state) => state.entries);
  return useMemo(() => sortTrashTypes(entries.values()), [entries]);
}
