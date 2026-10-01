import type { NotificationChannel, NotificationEventChannel } from '@/shared/api-sdk';

export type { NotificationChannel };

/** 事件管理頁的一個事件（`pages/NotificationEventList/adapter.ts` 由 DTO 轉成）。 */
export interface NotificationEventView {
  type: string;
  /** 沒有對應的文字（後端比前端新）時為 `undefined`，畫面以 `type` 顯示。 */
  nameKey?: string;
  descriptionKey?: string;
  recipientsKey?: string;
  mandatory: boolean;
  channels: NotificationEventChannel[];
}

export interface NotificationEventCategoryView {
  category: string;
  /** 不認得的分類為 `undefined`，畫面以分類名稱顯示。 */
  labelKey?: string;
  events: NotificationEventView[];
}
