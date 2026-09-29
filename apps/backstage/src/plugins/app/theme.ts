import type { AppPluginFactory } from '@/core/app';
import { useThemeStore } from '@/core/store';
import { applyTheme, DARK_COLOR_SCHEME_QUERY } from '@/core/theme';
import { Themes } from '@/shared/constants/theme';

/** 作業系統切換深淺色時，只有「跟隨系統」需要重新套用。 */
function onSystemSchemeChange(): void {
  const { theme } = useThemeStore.getState();
  if (theme === Themes.SYSTEM) applyTheme(theme);
}

/**
 * 首次繪製前的 `data-theme` 由 `public/theme-init.js` 設定（避免先閃白再變黑）；
 * 這個 plugin 接手之後的變化：使用者切換、其他分頁同步、以及「跟隨系統」時作業系統切換深淺色。
 */
export function themePlugin(): AppPluginFactory {
  return () => {
    let offStore: (() => void) | undefined;
    let offSystem: (() => void) | undefined;
    return {
      name: 'theme',
      onInit: () => {
        applyTheme(useThemeStore.getState().theme);
        offStore = useThemeStore.subscribe((state, previous) => {
          if (state.theme !== previous.theme) applyTheme(state.theme);
        });

        const media = globalThis.matchMedia?.(DARK_COLOR_SCHEME_QUERY);
        media?.addEventListener('change', onSystemSchemeChange);
        offSystem = () => media?.removeEventListener('change', onSystemSchemeChange);
      },
      onDestroy: () => {
        offStore?.();
        offSystem?.();
      },
    };
  };
}
