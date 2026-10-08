import { registerRouteLink } from '@b2b-system/web-core/route-link';

import { TagImportRoute } from './routes/pages';

/** 別的 feature 連到標籤頁面用的 route id（docs/architecture/frontend/03-feature-anatomy.md §4.1）。 */
export function registerTagRouteLinks(): void {
  // 匯入的結果（「我的匯入匯出」的「查看結果」，docs/architecture/backend/22-data-transfer.md §8.4）
  registerRouteLink('tag.import', {
    route: TagImportRoute,
    search: { mode: 'mode', transfer: 'transferId' },
  });
}
