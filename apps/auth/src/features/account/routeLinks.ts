import { registerRouteLink } from '@/core/route-link';

import { ProfileRoute } from './routes/pages';

/** 後端連結用的 route id（平台的站內通知，docs/architecture/backend/15-notification.md §6.2）；已發出的 id 不改名。 */
export function registerAccountRouteLinks(): void {
  registerRouteLink('account.profile', { route: ProfileRoute });
}
