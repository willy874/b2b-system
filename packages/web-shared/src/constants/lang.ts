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

/**
 * 把 BCP 47 語系標籤（帳號存的值、`navigator.language`、OIDC 的 `ui_locales`）對到支援的語系：
 * 完全相同優先（不分大小寫），其次是主語言相同（`en-GB` → `en-US`、`zh-Hant` → `zh-TW`）。對不到回傳 `undefined`。
 */
export function resolveLanguage(tag: string | null | undefined): Language | undefined {
  if (!tag) return undefined;
  const normalized = tag.trim().toLowerCase();
  const exact = SUPPORTED_LANGUAGES.find((language) => language.toLowerCase() === normalized);
  if (exact) return exact;
  const primary = normalized.split('-')[0];
  return SUPPORTED_LANGUAGES.find((language) => language.toLowerCase().split('-')[0] === primary);
}

/** 語言名稱一律用該語言自己的寫法（不翻譯），看不懂目前介面的人才找得到自己的語言。 */
export const LANGUAGE_LABELS: Record<Language, string> = {
  [Languages.ZH_TW]: '繁體中文',
  [Languages.EN_US]: 'English',
};

export const DEFAULT_TIMEZONE = 'Asia/Taipei';
