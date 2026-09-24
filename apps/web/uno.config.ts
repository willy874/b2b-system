import presetWind4 from '@unocss/preset-wind4';
import { defineConfig } from 'unocss';

/**
 * 顏色一律走 Design Token 的 CSS 變數（themes/），
 * 不在元件裡寫十六進位色碼（見 docs/architecture/frontend/07-ui-system.md）。
 */
export default defineConfig({
  presets: [presetWind4()],
  theme: {
    colors: {
      bg: 'var(--color-bg)',
      surface: 'var(--color-surface)',
      border: 'var(--color-border)',
      fg: 'var(--color-fg)',
      muted: 'var(--color-fg-muted)',
      brand: 'var(--color-brand)',
      'brand-fg': 'var(--color-brand-fg)',
      danger: 'var(--color-danger)',
    },
    radius: {
      sm: 'var(--radius-sm)',
      md: 'var(--radius-md)',
      lg: 'var(--radius-lg)',
    },
  },
});
