import { changeLanguage } from '@b2b-system/web-core/locales';
import { useLocaleStore } from '@b2b-system/web-core/store';
import { resolveLanguage } from '@b2b-system/web-shared/constants';
import { useEffect } from 'react';

/**
 * 從產品被導來登入時改用產品的介面語系（OIDC 的 `ui_locales`，依偏好排序、空白分隔）：
 * apps/platform 與 backstage 在不同網域、localStorage 不共用，不這樣做登入頁永遠用自己的設定。
 * 取第一個支援的語系，寫進本機偏好（之後的帳號流程頁面也用它）並切換。只在 `uiLocales` 改變時套用：
 * 使用者在登入頁自己再切換語言不會被蓋回去。
 */
export function useRequestedLocale(uiLocales: string | null | undefined): void {
  useEffect(() => {
    const requested = uiLocales
      ?.split(/\s+/)
      .map((tag) => resolveLanguage(tag))
      .find((language) => language !== undefined);
    if (!requested || requested === useLocaleStore.getState().locale) return;
    useLocaleStore.getState().setLocale(requested);
    void changeLanguage(requested);
  }, [uiLocales]);
}
