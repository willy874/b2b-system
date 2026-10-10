import { registerBatchOperation } from '@b2b-system/web-core/batch';

/** 通知列表的批次操作 id（`NotificationBatchBar` 的 `operations`）。 */
export const NotificationBatchOperation = {
  MARK_READ: 'notification.markRead',
  DELETE: 'notification.delete',
} as const;

/** 實作在第一次執行時才載入（docs/architecture/frontend/02-plugin-system.md §4.8）。 */
const runs = () => import('./batchRuns');

/**
 * 在 plugin 的同步階段呼叫。逐筆打單筆的「標為已讀」與「刪除」，與列尾的按鈕相同。
 * 名稱與提示在 web-core 的全域語系包（`notificationBatch.*`），不必補載 feature 的 scope。
 */
export function registerNotificationBatchOperations(): void {
  registerBatchOperation({
    id: NotificationBatchOperation.MARK_READ,
    labelKey: 'notificationBatch.markRead.title',
    successKey: 'notificationBatch.markRead.success',
    run: async (notificationId, context) => (await runs()).markReadRun(notificationId, context),
  });
  registerBatchOperation({
    id: NotificationBatchOperation.DELETE,
    labelKey: 'notificationBatch.delete.title',
    successKey: 'notificationBatch.delete.success',
    run: async (notificationId, context) => (await runs()).deleteRun(notificationId, context),
  });
}
