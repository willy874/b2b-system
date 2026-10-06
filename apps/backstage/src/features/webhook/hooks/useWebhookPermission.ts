import { useMemo } from 'react';

import { usePagePermission } from '@/core/permission';

import { WEBHOOK_PAGE } from '../permission';

/**
 * 頁面元件只呼叫這一個 hook，不直接碰 usePermission()。
 * 改設定、停用與啟用、輪替密鑰、送測試事件、重送都是 `webhook:update`（docs/architecture/backend/17-webhook.md §9.2 D6）。
 */
export function useWebhookPermission() {
  const page = usePagePermission(WEBHOOK_PAGE);
  // 權限沒變時回傳同一個物件（列表的 rows 等 memo 以它或它的欄位為依賴）
  return useMemo(
    () => ({
      ...page,
      /** 送測試事件與重送：讓接收端再收一次 */
      canSend: page.canUpdate,
      canRotateSecret: page.canUpdate,
    }),
    [page],
  );
}
