export const Themes = {
  LIGHT: 'light',
  DARK: 'dark',
  SYSTEM: 'system',
} as const;

/** 使用者選的主題；`system` 跟隨作業系統的 `prefers-color-scheme`。 */
export type ThemePreference = (typeof Themes)[keyof typeof Themes];

/** 實際套用在 `<html data-theme>` 的主題。 */
export type ResolvedTheme = Exclude<ThemePreference, 'system'>;

export const DEFAULT_THEME: ThemePreference = Themes.SYSTEM;

export const SUPPORTED_THEMES: ThemePreference[] = [Themes.LIGHT, Themes.DARK, Themes.SYSTEM];
