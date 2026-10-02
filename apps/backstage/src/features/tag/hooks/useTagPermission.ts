import { usePagePermission } from '@/core/permission';

import { TAG_PAGE } from '../permission';

/** 頁面元件只呼叫這一個 hook，不直接碰 usePermission()（docs/architecture/backend/18-tag.md §7.2 D5）。 */
export function useTagPermission() {
  return usePagePermission(TAG_PAGE);
}
