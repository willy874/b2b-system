import type { UserStatus } from '@/db/schema';
import { defineWebhookEvent } from '@/modules/webhook/webhook.definition';
import type { AnyWebhookEventType } from '@/modules/webhook/webhook.definition';

/**
 * 使用者的對外事件（docs/architecture/backend/17-webhook.md §9.2 D2、D3）：只帶 id 與狀態，email 與名稱由接收端以 API token 回查。
 * 服務帳號不發（它不是人，建立與停用由服務帳號頁管理）。
 */

/** 建立帳號：管理者建立、註冊審批通過、外部 IdP 首次登入自動建立。 */
export const USER_CREATED_WEBHOOK = defineWebhookEvent<{ userId: string }>('user.created', {
  version: 1,
});

/** 狀態改變：停用、啟用、鎖定、解鎖、完成啟用（`pending` → `active`）。 */
export const USER_STATUS_CHANGED_WEBHOOK = defineWebhookEvent<{
  userId: string;
  status: UserStatus;
  previousStatus: UserStatus;
}>('user.statusChanged', { version: 1 });

/** 刪除（軟刪除，可由回收桶還原）。 */
export const USER_DELETED_WEBHOOK = defineWebhookEvent<{ userId: string }>('user.deleted', {
  version: 1,
});

/** 從回收桶還原：狀態維持刪除前的值。回收桶沒有開放時不會發生，可訂閱的清單也不列。 */
export const USER_RESTORED_WEBHOOK = defineWebhookEvent<{ userId: string }>('user.restored', {
  version: 1,
  feature: 'trash',
});

export const USER_WEBHOOK_EVENTS: readonly AnyWebhookEventType[] = [
  USER_CREATED_WEBHOOK,
  USER_STATUS_CHANGED_WEBHOOK,
  USER_DELETED_WEBHOOK,
  USER_RESTORED_WEBHOOK,
];
