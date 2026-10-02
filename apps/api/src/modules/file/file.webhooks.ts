import { defineWebhookEvent } from '@/modules/webhook/webhook.definition';
import type { AnyWebhookEventType } from '@/modules/webhook/webhook.definition';

/**
 * 檔案上傳完成（docs/architecture/backend/17-webhook.md §9.2 D2、D3）：內容已確認存在、大小相符。只帶 id；
 * 檔名與內容由接收端以 API token 回查（回查時套用 token 對資料夾的權限）。
 */
export const FILE_UPLOADED_WEBHOOK = defineWebhookEvent<{
  fileId: string;
  folderId: string | null;
}>('file.uploaded', { version: 1, feature: 'file' });

export const FILE_WEBHOOK_EVENTS: readonly AnyWebhookEventType[] = [FILE_UPLOADED_WEBHOOK];
