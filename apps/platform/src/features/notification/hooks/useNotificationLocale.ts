import { useEffect, useReducer } from 'react';

import { loadLocaleScope, useTranslation } from '@/core/locales';

import { NOTIFICATION_LOCALE_SCOPE } from '../locale';

/**
 * 頂列的鈴鐺在每一頁都看得到，不經過本 feature 的 route loader：掛上時自己載入語系包，載完重渲染。
 * 已載入過的 scope 不會重複下載；切換語系時 `changeLanguage` 會補載新語系的版本（docs/architecture/frontend/08-i18n.md §2.3）。
 */
export function useNotificationLocale(): void {
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const { language } = useTranslation();
  useEffect(() => {
    let isCurrent = true;
    void loadLocaleScope(NOTIFICATION_LOCALE_SCOPE, language).then(() => {
      if (isCurrent) rerender();
    });
    return () => {
      isCurrent = false;
    };
  }, [language]);
}
