import { registerRouteLink } from '@b2b-system/web-core/route-link';

import { ServiceAccountDetailRoute } from './routes/pages';

/** 別的 feature 與命令面板連到服務帳號頁面用的 route id（docs/architecture/frontend/03-feature-anatomy.md §4.1）。 */
export function registerServiceAccountRouteLinks(): void {
  registerRouteLink('serviceAccount.detail', {
    route: ServiceAccountDetailRoute,
    params: { serviceAccountId: 'serviceAccountId' },
  });
}
