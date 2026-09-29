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

export const DEFAULT_TIMEZONE = 'Asia/Taipei';
