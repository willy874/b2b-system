import type { PermissionCatalog } from '@/shared/api-sdk';

import type { PermissionFilters } from '../routes';

/** 有沒有任何一個篩選條件生效。 */
export function hasPermissionFilters({ keyword, resource, held }: PermissionFilters): boolean {
  return Boolean(keyword) || (resource?.length ?? 0) > 0 || held !== undefined;
}

/**
 * 依篩選條件縮減目錄（純函式）：權限鍵與它所屬的資源都要符合；沒有任何符合的資源整組拿掉。
 * `nameOf` 是目前語系的權限名稱，關鍵字同時比對名稱與權限鍵。
 */
export function filterPermissionCatalog(
  catalog: PermissionCatalog,
  { keyword, resource, held }: PermissionFilters,
  isHeld: (key: string) => boolean,
  nameOf: (key: string) => string,
): PermissionCatalog {
  if (!hasPermissionFilters({ keyword, resource, held })) return catalog;
  const needle = keyword?.toLowerCase();
  const resources = resource && resource.length > 0 ? new Set(resource) : undefined;
  const matches = (key: string): boolean =>
    (!needle || key.toLowerCase().includes(needle) || nameOf(key).toLowerCase().includes(needle)) &&
    (held === undefined || isHeld(key) === (held === 'held'));

  const groups = catalog.groups.flatMap((group) => {
    if (resources && !resources.has(group.resource)) return [];
    const keys = group.keys.filter((key) => matches(key));
    return keys.length > 0 ? [{ ...group, keys }] : [];
  });
  const visible = new Set(groups.flatMap((group) => group.keys as string[]));
  return { items: catalog.items.filter((item) => visible.has(item.key)), groups };
}
