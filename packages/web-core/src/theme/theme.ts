import type { IconName } from '@b2b-system/ui/Icon';
import { Themes } from '@b2b-system/web-shared/constants';
import type { ResolvedTheme, ThemePreference } from '@b2b-system/web-shared/constants';

export const DARK_COLOR_SCHEME_QUERY = '(prefers-color-scheme: dark)';

export interface ThemeOption {
  value: ThemePreference;
  labelKey: string;
  icon: IconName;
}

/** 主題選單的選項；頂列的快速切換與偏好頁共用，語系鍵在這個 package 的 `locales/resources`。 */
export const THEME_OPTIONS: ThemeOption[] = [
  { value: Themes.LIGHT, labelKey: 'theme.light', icon: 'sun' },
  { value: Themes.DARK, labelKey: 'theme.dark', icon: 'moon' },
  { value: Themes.SYSTEM, labelKey: 'theme.system', icon: 'monitor' },
];

/** `system` 依作業系統解析；沒有 `matchMedia`（測試環境）時視為淺色。 */
export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  if (preference !== Themes.SYSTEM) return preference;
  return globalThis.matchMedia?.(DARK_COLOR_SCHEME_QUERY).matches ? Themes.DARK : Themes.LIGHT;
}

/** 設定 `<html data-theme>`，`packages/ui/src/styles/tokens.css` 以它切換 alias 層。 */
export function applyTheme(preference: ThemePreference): void {
  document.documentElement.dataset.theme = resolveTheme(preference);
}
