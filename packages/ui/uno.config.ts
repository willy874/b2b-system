import presetWind4 from '@unocss/preset-wind4';
import { defineConfig } from 'unocss';

/**
 * 顏色一律走 Design Token 的 CSS 變數（`src/styles/tokens.css`），
 * 不在元件裡寫十六進位色碼（見 docs/architecture/frontend/07-ui-system.md）。
 */
export default defineConfig({
  presets: [presetWind4()],
  // 工具類輸出到 `utilities` 層，排在元件的 `components` 層之後：
  // 呼叫端傳進元件的 className / classNames 一定蓋得過元件預設樣式，不受 CSS 載入順序影響。
  // 層的順序在 index.html 的 <style> 宣告。
  outputToCssLayers: {
    cssLayerName: (layer) => {
      if (layer === 'properties') return null;
      if (layer === 'theme' || layer === 'preflights' || layer === 'base') return 'reset';
      return 'utilities';
    },
  },
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
