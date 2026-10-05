import type { Decorator, Preview } from '@storybook/react-vite';
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from '@tanstack/react-router';

import 'virtual:uno.css';
import '../src/styles/index.css';

/**
 * `parameters: { router: true }` 的 story 包一層記憶體 router，
 * 給需要 TanStack Router context 的元件（`ButtonLink`、以 `render` 接 router `Link` 的元件）。
 * 點連結不會離開 Storybook。
 */
const withRouter: Decorator = (Story, context) => {
  if (!context.parameters.router) return <Story />;
  const router = createRouter({
    routeTree: createRootRoute({ component: Story }),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  return <RouterProvider router={router} />;
};

/**
 * 工具列的「Theme」切換 `<html data-theme>`，與 app 相同的機制（src/styles/tokens.css）。
 * 預設跟著 app 的預設（跟隨系統）解析，方便直接用作業系統的深淺色檢查。
 * Docs 頁的外框是 Storybook 自己的白底，所以每個 story 再包一層主題底色，深色時才看得出實際效果。
 */
const withTheme: Decorator = (Story, context) => {
  const selected = context.globals.theme as string | undefined;
  const dark =
    selected === 'dark' ||
    (selected !== 'light' && globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  return (
    <div
      className="p-4 rounded-md"
      style={{ background: 'var(--color-bg)', color: 'var(--color-fg)' }}
    >
      <Story />
    </div>
  );
};

const preview: Preview = {
  decorators: [withRouter, withTheme],
  globalTypes: {
    theme: {
      description: '主題',
      toolbar: {
        title: 'Theme',
        icon: 'mirror',
        items: [
          { value: 'system', title: 'System' },
          { value: 'light', title: 'Light' },
          { value: 'dark', title: 'Dark' },
        ],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: { theme: 'system' },
  parameters: {
    layout: 'centered',
    controls: { expanded: true },
  },
  tags: ['autodocs'],
};

export default preview;
