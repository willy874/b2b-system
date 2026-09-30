import { useMemo } from 'react';

import { usePermission } from '@/core/permission';
import { useTrashTypes } from '@/core/trash';
import type { TrashTypeRegistration } from '@/core/trash';

/**
 * 回收桶頁的權限 facade：登記的類型中，目前的人看得到的那些（各自的 `<resource>:delete`）。
 * 權限未水合時是空的：分頁與還原按鈕不閃現。
 */
export function useTrashPermission(): { hydrated: boolean; types: TrashTypeRegistration[] } {
  const { hydrated, can } = usePermission();
  const registered = useTrashTypes();
  const types = useMemo(
    () => (hydrated ? registered.filter((type) => can(type.permission)) : []),
    [can, hydrated, registered],
  );
  return { hydrated, types };
}
