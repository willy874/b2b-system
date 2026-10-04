import { createRootRoute } from '@tanstack/react-router';

/**
 * 元件由 `app/routes.tsx` 用 `.update({ component: Layout })` 補上——
 * core 不可以認識 app 或任何 feature。
 */
export const RootRoute = createRootRoute();
