import type { StorybookConfig } from '@storybook/react-vite';

/**
 * 設計系統元件（`src/components/`）的 Storybook。
 * Vite 設定沿用 `vite.config.ts`（UnoCSS、svgr、`@/` alias、CSS Module 命名）。
 * 見 docs/architecture/frontend/07-ui-system.md §9。
 */
const config: StorybookConfig = {
  stories: ['../src/components/**/*.stories.tsx'],
  addons: ['@storybook/addon-docs', '@storybook/addon-a11y'],
  framework: '@storybook/react-vite',
  core: { disableTelemetry: true },
};

export default config;
