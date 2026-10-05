import react from '@vitejs/plugin-react';
import unocss from 'unocss/vite';
import { defineConfig } from 'vite';
import svgr from 'vite-plugin-svgr';

/**
 * 只給 Storybook 用（`.storybook/` 沿用這份設定）；各 app 以自己的 vite.config.ts 編譯這個 package 的原始碼，
 * CSS Module 的 class 前綴也由 app 決定（backstage `ge-`、platform `ga-`）。
 */
export default defineConfig({
  plugins: [unocss(), react(), svgr()],
  css: {
    modules: {
      generateScopedName: 'ui-[name]__[local]__[hash:base64:4]',
    },
  },
});
