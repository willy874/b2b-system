import { useCallback } from 'react';

import { useToast } from '@/components/Toast';

import { isSilentError, useErrorMessage } from './useErrorMessage';

/** mutation 的 `onError` 用：顯示本地化錯誤訊息，略過被刻意中止的請求。 */
export function useErrorToast(): (error: unknown) => void {
  const toast = useToast();
  const toMessage = useErrorMessage();
  return useCallback(
    (error: unknown) => {
      if (!isSilentError(error)) toast.error(toMessage(error));
    },
    [toast, toMessage],
  );
}
