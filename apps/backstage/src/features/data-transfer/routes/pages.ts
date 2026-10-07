import { RootRoute } from '@b2b-system/web-core/router';
import { createRoute, stripSearchParams } from '@tanstack/react-router';

import { requireFeature } from '@/core/feature';

import { DataTransferSearchQuerySchema, DEFAULT_DATA_TRANSFER_SEARCH } from './model';

/** 這個 feature 在租戶啟用清單裡的 id（後端 `TENANT_FEATURES`）。 */
export const DATA_TRANSFER_FEATURE = 'dataTransfer';

/** 我的匯入匯出（docs/architecture/backend/22-data-transfer.md §8.4）。字串都在 web-core 的 `dataTransfer`，沒有自己的語系包。 */
export const DataTransferListRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: '/data-transfer',
  staticData: { titleKey: 'menu.dataTransfer' },
  beforeLoad: requireFeature(DATA_TRANSFER_FEATURE),
  validateSearch: DataTransferSearchQuerySchema,
  search: { middlewares: [stripSearchParams(DEFAULT_DATA_TRANSFER_SEARCH)] },
});
