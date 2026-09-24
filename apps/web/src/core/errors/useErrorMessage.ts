import { useCallback } from 'react';

import { AbortReason, isRequestAborted } from '@/core/client';
import { useTranslation } from '@/core/locales';

import { AppError } from './AppError';
import { getErrorMessageKey } from './errorMessageKey';

/**
 * 不需要告訴使用者的錯誤：呼叫端自己取消的請求、session 結束時被一併中止的請求
 * （畫面正在跳轉登入頁）。逾時不在此列——使用者需要知道操作沒有完成。
 */
export function isSilentError(error: unknown): boolean {
  return isRequestAborted(error) && error.reason !== AbortReason.TIMEOUT;
}

export function useErrorMessage(): (error: unknown) => string {
  const { t } = useTranslation();
  return useCallback(
    (error: unknown) => {
      if (isRequestAborted(error)) {
        return error.reason === AbortReason.TIMEOUT ? t('error.timeout') : t('error.aborted');
      }
      if (!(error instanceof AppError)) return t('error.unknown');
      const key = getErrorMessageKey(error.code);
      const message = key ? t(key) : undefined;
      // 不認得的碼、或沒有對應翻譯時，退回通用訊息＋requestId，不在畫面上顯示原始 key
      return message && message !== key
        ? message
        : t('error.unknown_with_id', { requestId: error.requestId ?? '-' });
    },
    [t],
  );
}
