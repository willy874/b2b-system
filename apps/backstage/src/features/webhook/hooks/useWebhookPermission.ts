import { usePagePermission } from '@/core/permission';

import { WEBHOOK_PAGE } from '../permission';

/**
 * 頁面元件只呼叫這一個 hook，不直接碰 usePermission()。
 * 改設定、停用與啟用、輪替密鑰、送測試事件、重送都是 `webhook:update`（docs/adr/0030-webhooks.md D6）。
 */
export function useWebhookPermission() {
  const page = usePagePermission(WEBHOOK_PAGE);
  return {
    ...page,
    /** 送測試事件與重送：讓接收端再收一次 */
    canSend: page.canUpdate,
    canRotateSecret: page.canUpdate,
  };
}
