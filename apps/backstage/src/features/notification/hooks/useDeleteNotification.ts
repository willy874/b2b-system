import { useErrorToast } from '@b2b-system/web-core/errors';
import { useCallback } from 'react';

import { useDeleteNotificationMutation } from './useNotificationMutations';

/** 刪除一則（列尾的按鈕、詳細內容的「刪除」）：不確認、不可復原；失敗只提示。 */
export function useDeleteNotification(): (notificationId: string) => void {
  const { mutate } = useDeleteNotificationMutation();
  const showError = useErrorToast();
  return useCallback(
    (notificationId) => mutate({ params: { notificationId } }, { onError: showError }),
    [mutate, showError],
  );
}
