import { lazyRouteComponent } from '@tanstack/react-router';

export const AsyncIdentityProviderListPage = lazyRouteComponent(
  () => import('./IdentityProviderList/page'),
);
