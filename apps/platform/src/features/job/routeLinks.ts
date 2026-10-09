import { registerRouteLink } from '@b2b-system/web-core/route-link';

import { JobListRoute } from './routes/pages';

/**
 * 其他 feature 連到背景工作的 route id（docs/architecture/frontend/03-feature-anatomy.md §4.1）；已發出的 id 不改名。
 * `job.byName`：只看某一種工作（例：CDN 頁面的「最近的清理」連到 `cdn.purge`）。
 */
export function registerJobRouteLinks(): void {
  registerRouteLink('job.byName', { route: JobListRoute, search: { name: 'name' } });
}
