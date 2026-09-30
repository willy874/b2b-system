import { useCallback } from 'react';

import { AbortReason, isNetworkError, isRequestAborted } from '@/core/client';
import { useTranslation } from '@/core/locales';

import { AppError, ErrorCodes } from './AppError';
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
      if (isNetworkError(error)) return t('error.network');
      if (!(error instanceof AppError)) return t('error.unknown');
      // 限流：告訴使用者要等多久，而不是「稍後」（一直重試只會讓限流持續更久）
      const { retryAfterSeconds } = error;
      if (error.code === ErrorCodes.RATE_LIMITED && retryAfterSeconds !== undefined) {
        return t('error.rate_limited_retry', { seconds: retryAfterSeconds });
      }
      const key = getErrorMessageKey(error.code);
      // details 的純量值當插值參數（例：ROLE_IN_USE 的 userCount），讓訊息說得出「幾位」「哪一個」
      const message = key ? t(key, interpolationOf(error.details)) : undefined;
      // 不認得的碼、或沒有對應翻譯時，退回通用訊息＋requestId，不在畫面上顯示原始 key
      return message && message !== key
        ? message
        : t('error.unknown_with_id', { requestId: error.requestId ?? '-' });
    },
    [t],
  );
}

/** 只取 details 的字串與數字：物件（例：`fields`）不是給人看的文字。 */
function interpolationOf(details: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!details) return {};
  return Object.fromEntries(
    Object.entries(details).filter(
      ([, value]) => typeof value === 'string' || typeof value === 'number',
    ),
  );
}
