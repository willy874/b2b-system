import { usePagePermission } from '@/core/permission';

import { TAG_PAGE } from '../permission';

/** 頁面元件只呼叫這一個 hook，不直接碰 usePermission()（docs/adr/0032-tags.md D5）。 */
export function useTagPermission() {
  return usePagePermission(TAG_PAGE);
}
