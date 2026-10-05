import { useTranslation } from '@b2b-system/web-core/locales';
import { useLocaleStore } from '@b2b-system/web-core/store';
import type { Language } from '@b2b-system/web-shared/constants';
import { useMutation } from '@tanstack/react-query';
import { useCallback } from 'react';

import { getUpdateProfileMutationOptions } from '@/apis/auth/update-profile/mutation';
import { invalidateResources, selfUpdated } from '@/apis/resources';

/**
 * 切換介面語系：寫入本機偏好（跨分頁同步）、切換 i18n、同步到帳號。
 * 偏好頁與頂列的語言選單共用，兩個入口的行為才不會分岔。
 */
export function useChangeLocale(): (locale: Language) => void {
  const { changeLanguage } = useTranslation();
  const setLocale = useLocaleStore((state) => state.setLocale);
  const { mutate } = useMutation({
    ...getUpdateProfileMutationOptions(),
    onSuccess: (updated) => invalidateResources([selfUpdated(updated)]),
  });

  return useCallback(
    (locale: Language) => {
      setLocale(locale);
      void changeLanguage(locale);
      mutate({ params: { preferences: { locale } } });
    },
    [changeLanguage, mutate, setLocale],
  );
}
