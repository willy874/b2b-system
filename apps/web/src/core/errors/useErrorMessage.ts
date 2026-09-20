import { useCallback } from 'react';

import { useTranslation } from '@/core/locales';

import { AppError } from './AppError';

export function useErrorMessage(): (error: unknown) => string {
  const { t } = useTranslation();
  return useCallback(
    (error: unknown) => {
      if (!(error instanceof AppError)) return t('error.unknown');
      const key = `error.${error.code}`;
      const message = t(key);
      // 沒有對應翻譯時退回通用訊息＋requestId，不在畫面上顯示原始 key
      return message === key
        ? t('error.unknown_with_id', { requestId: error.requestId ?? '-' })
        : message;
    },
    [t],
  );
}
