import { useEffect, useReducer } from 'react';

import { changeLanguage, i18n } from './i18n';

export interface TranslationFacade {
  t: (key: string, options?: Record<string, unknown>) => string;
  language: string;
  changeLanguage: typeof changeLanguage;
}

/** 約 30 行的薄封裝：語系變了重渲染，不用 react-i18next。 */
export function useTranslation(): TranslationFacade {
  const [, force] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    i18n.on('languageChanged', force);
    return () => {
      i18n.off('languageChanged', force);
    };
  }, []);

  return {
    t: (key, options) => i18n.t(key, options ?? {}) as string,
    language: i18n.language,
    changeLanguage,
  };
}
