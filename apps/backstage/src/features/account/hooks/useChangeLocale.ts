import { useErrorToast } from '@b2b-system/web-core/errors';
import { useTranslation } from '@b2b-system/web-core/locales';
import { useLocaleStore } from '@b2b-system/web-core/store';
import type { Language } from '@b2b-system/web-shared/constants';
import { useMutation } from '@tanstack/react-query';
import { useCallback } from 'react';

import { getUpdateProfileMutationOptions } from '@/apis/auth/update-profile/mutation';
import { invalidateResources, selfUpdated } from '@/apis/resources';

export interface ChangeLocaleOptions {
  /** 同步到帳號成功之後（偏好頁在這時才顯示「已儲存」）。 */
  onSaved?: () => void;
}

/**
 * 切換介面語系：寫入本機偏好（跨分頁同步）、切換 i18n、同步到帳號。
 * 偏好頁與頂列的語言選單共用，兩個入口的行為才不會分岔。同步失敗時顯示錯誤提示
 * （畫面已經切換；下次載入時以帳號為準，docs/architecture/frontend/08-i18n.md §1）。
 */
export function useChangeLocale(): (locale: Language, options?: ChangeLocaleOptions) => void {
  const { changeLanguage } = useTranslation();
  const setLocale = useLocaleStore((state) => state.setLocale);
  const errorToast = useErrorToast();
  const { mutate } = useMutation({
    ...getUpdateProfileMutationOptions(),
    onSuccess: (updated) => invalidateResources([selfUpdated(updated)]),
    onError: errorToast,
  });

  return useCallback(
    (locale: Language, options?: ChangeLocaleOptions) => {
      setLocale(locale);
      void changeLanguage(locale);
      mutate({ params: { preferences: { locale } } }, { onSuccess: () => options?.onSaved?.() });
    },
    [changeLanguage, mutate, setLocale],
  );
}
