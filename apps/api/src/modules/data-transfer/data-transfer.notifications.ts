import {
  defineNotification,
  NotificationChannel,
} from '@/modules/notification/notification.definition';
import type {
  AnyNotificationType,
  NotificationLink,
} from '@/modules/notification/notification.definition';

/** 通知的參數：`status` 是 `completed` ｜ `failed`，`type` 是資源類型（前端翻譯成資源名稱）。 */
export type DataTransferFinishedParams = {
  status: string;
  type: string;
  format: string;
  rows: number;
  errorCode: string | null;
};

export type DataTransferImportFinishedParams = {
  status: string;
  type: string;
  mode: string;
  succeeded: number;
  failed: number;
  skipped: number;
  errorCode: string | null;
};

/** 匯出完成或失敗（docs/architecture/backend/22-data-transfer.md §9.3）。 */
export const DATA_TRANSFER_EXPORT_FINISHED_NOTIFICATION =
  defineNotification<DataTransferFinishedParams>('dataTransfer.exportFinished', {
    category: 'dataTransfer',
    channels: [NotificationChannel.IN_APP],
    feature: 'dataTransfer',
  });

/** 匯入套用完成或失敗。 */
export const DATA_TRANSFER_IMPORT_FINISHED_NOTIFICATION =
  defineNotification<DataTransferImportFinishedParams>('dataTransfer.importFinished', {
    category: 'dataTransfer',
    channels: [NotificationChannel.IN_APP],
    feature: 'dataTransfer',
  });

export const DATA_TRANSFER_NOTIFICATIONS: readonly AnyNotificationType[] = [
  DATA_TRANSFER_EXPORT_FINISHED_NOTIFICATION,
  DATA_TRANSFER_IMPORT_FINISHED_NOTIFICATION,
];

export function dataTransferDetailLink(transferId: string): NotificationLink {
  return { route: 'dataTransfer.detail', params: { transferId } };
}
