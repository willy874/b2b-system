import { useEffect, useMemo, useReducer } from 'react';

import { changeLanguage, i18n, subscribeLocaleScopeLoaded } from './i18n';

export interface TranslationFacade {
  t: (key: string, options?: Record<string, unknown>) => string;
  language: string;
  changeLanguage: typeof changeLanguage;
}

/** 約 30 行的薄封裝：語系變了、或有語系包載入完成時重渲染，不用 react-i18next。 */
export function useTranslation(): TranslationFacade {
  const [version, force] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    i18n.on('languageChanged', force);
    // 晚到的語系包（可啟用的 feature 安裝後才登記，ADR-0021）：已經掛上的元件要換成翻譯後的字串
    const unsubscribe = subscribeLocaleScopeLoaded(force);
    return () => {
      i18n.off('languageChanged', force);
      unsubscribe();
    };
  }, []);

  // `t` 常被放進 useMemo / useCallback / useEffect 的依賴：
  // 字串沒變時要維持同一個參考；切換語系或有語系包載入完成時才換新，讓依賴它的 memo 重算翻譯。
  return useMemo(
    () => ({
      t: (key, options) => i18n.t(key, options ?? {}) as string,
      language: i18n.language,
      changeLanguage,
    }),
    // version 是語系變更與語系包載入的訊號
    // oxlint-disable-next-line react-hooks/exhaustive-deps, react/memo-dependencies
    [version],
  );
}
