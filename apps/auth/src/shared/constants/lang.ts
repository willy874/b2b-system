export const Languages = {
  EN_US: 'en-US',
  ZH_TW: 'zh-TW',
} as const;

export type Language = (typeof Languages)[keyof typeof Languages];

export const DEFAULT_LANGUAGE: Language = Languages.ZH_TW;

export const LanguageNamespace = {
  TRANSLATE: 'translation',
} as const;

export const SUPPORTED_LANGUAGES: Language[] = [Languages.ZH_TW, Languages.EN_US];

/** 語言名稱一律用該語言自己的寫法（不翻譯），看不懂目前介面的人才找得到自己的語言。 */
export const LANGUAGE_LABELS: Record<Language, string> = {
  [Languages.ZH_TW]: '繁體中文',
  [Languages.EN_US]: 'English',
};

export const DEFAULT_TIMEZONE = 'Asia/Taipei';
