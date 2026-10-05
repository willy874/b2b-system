import { useTranslation } from '@b2b-system/web-core/locales';
import { useMemo } from 'react';

import type { PermissionCatalog } from '@/shared/api-sdk';

import type { PermissionFilters } from '../routes';
import { filterPermissionCatalog } from './permissionCatalogFilter';

/** 套用篩選後的目錄（一覽表與樹狀圖共用）；名稱以目前語系比對。 */
export function useFilteredPermissionCatalog(
  catalog: PermissionCatalog | undefined,
  filters: PermissionFilters,
  held: ReadonlySet<string>,
): PermissionCatalog | undefined {
  const { t } = useTranslation();
  const { keyword, resource, held: heldFilter } = filters;
  return useMemo(() => {
    if (!catalog) return undefined;
    const names = new Map(catalog.items.map((item) => [item.key as string, t(item.nameI18nKey)]));
    return filterPermissionCatalog(
      catalog,
      { keyword, resource, held: heldFilter },
      (key) => held.has(key),
      (key) => names.get(key) ?? key,
    );
  }, [catalog, keyword, resource, heldFilter, held, t]);
}
