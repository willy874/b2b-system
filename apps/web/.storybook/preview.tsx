import type { Decorator, Preview } from '@storybook/react-vite';
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from '@tanstack/react-router';

import 'virtual:uno.css';
import '../src/index.css';

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

const preview: Preview = {
  decorators: [withRouter],
  parameters: {
    layout: 'centered',
    controls: { expanded: true },
  },
  tags: ['autodocs'],
};

export default preview;
