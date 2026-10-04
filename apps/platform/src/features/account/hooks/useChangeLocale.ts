import { useCallback } from 'react';

import { useTranslation } from '@/core/locales';
import { useLocaleStore } from '@/core/store';
import type { Language } from '@/shared/constants/lang';

/**
 * 切換介面語系：寫入本機偏好（跨分頁同步）並切換 i18n。偏好頁與頂列的語言選單共用。
 * 平台管理者的帳號沒有存偏好（docs/architecture/04-sso.md §6.2），所以不像 backstage 同步到帳號。
 */
export function useChangeLocale(): (locale: Language) => void {
  const { changeLanguage } = useTranslation();
  const setLocale = useLocaleStore((state) => state.setLocale);

  return useCallback(
    (locale: Language) => {
      setLocale(locale);
      void changeLanguage(locale);
    },
    [changeLanguage, setLocale],
  );
}
