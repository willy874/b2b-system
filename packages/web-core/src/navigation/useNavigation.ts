import { useStore } from '@b2b-system/web-shared/hooks';
import { useMemo } from 'react';

import { navGroupRegistry, navItemRegistry, resolveNavigation } from './registry';
import type { ResolvedNavigation } from './registry';

/** 登記的選單（未依權限過濾）；feature 在執行期安裝或卸載時跟著更新。 */
export function useNavigation(): ResolvedNavigation {
  const groups = useStore(navGroupRegistry.store, (state) => state.entries);
  const items = useStore(navItemRegistry.store, (state) => state.entries);
  return useMemo(() => resolveNavigation(groups.values(), items.values()), [groups, items]);
}
