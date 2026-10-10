import type { BatchRunContext } from '@b2b-system/web-core/batch';

import { getDeleteNotificationMutationOptions } from '@/apis/notification/delete-notification/mutation';
import { getMarkNotificationReadMutationOptions } from '@/apis/notification/mark-notification-read/mutation';
import { Resource } from '@/apis/resources';

/** 通知批次操作的實作：`batch.ts` 在第一次執行時才以 `import()` 載入（docs/architecture/frontend/02-plugin-system.md §4.8）。 */
const markRead = getMarkNotificationReadMutationOptions().mutationFn;
const remove = getDeleteNotificationMutationOptions().mutationFn;

export async function markReadRun(
  notificationId: string,
  { invalidate }: BatchRunContext,
): Promise<void> {
  await markRead({ params: { notificationId } });
  invalidate([{ resource: Resource.NOTIFICATION, kind: 'update', id: notificationId }]);
}

export async function deleteRun(
  notificationId: string,
  { invalidate }: BatchRunContext,
): Promise<void> {
  await remove({ params: { notificationId } });
  invalidate([{ resource: Resource.NOTIFICATION, kind: 'delete', id: notificationId }]);
}
