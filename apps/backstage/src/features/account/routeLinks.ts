import { registerRouteLink } from '@/core/route-link';

import { ProfileRoute } from './routes/pages';

/** 後端連結用的 route id（docs/architecture/backend/15-notification.md §4.1）；已發出的 id 不改名。 */
export function registerAccountRouteLinks(): void {
  registerRouteLink('account.profile', { route: ProfileRoute });
}
