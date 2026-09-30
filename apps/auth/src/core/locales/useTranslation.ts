import { useEffect, useMemo, useReducer } from 'react';

import { changeLanguage, i18n } from './i18n';

export interface TranslationFacade {
  t: (key: string, options?: Record<string, unknown>) => string;
  language: string;
  changeLanguage: typeof changeLanguage;
}

/** 約 30 行的薄封裝：語系變了重渲染，不用 react-i18next。 */
export function useTranslation(): TranslationFacade {
  const [version, force] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    i18n.on('languageChanged', force);
    return () => {
      i18n.off('languageChanged', force);
    };
  }, []);

  // `t` 常被放進 useMemo / useCallback / useEffect 的依賴：
  // 同一語系下要維持同一個參考，切換語系時才換新，讓依賴它的 memo 重算翻譯。
  return useMemo(
    () => ({
      t: (key, options) => i18n.t(key, options ?? {}) as string,
      language: i18n.language,
      changeLanguage,
    }),
    // version 是語系變更的訊號
    // oxlint-disable-next-line react-hooks/exhaustive-deps, react/memo-dependencies
    [version],
  );
}
