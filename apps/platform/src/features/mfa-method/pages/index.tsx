import { lazyRouteComponent } from '@tanstack/react-router';

export const AsyncMfaMethodListPage = lazyRouteComponent(() => import('./MfaMethodList/page'));
