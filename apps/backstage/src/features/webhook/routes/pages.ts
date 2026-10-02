import { createRoute, stripSearchParams } from '@tanstack/react-router';

import { requireFeature } from '@/core/feature';
import { localeScopeLoader } from '@/core/locales';
import { RootRoute } from '@/core/router';

import { WEBHOOK_LOCALE_SCOPE } from '../locale';
import { DEFAULT_WEBHOOK_SEARCH, WebhookSearchQuerySchema } from './model';

/** 這個 feature 在租戶啟用清單裡的 id（後端 `TENANT_FEATURES`，docs/architecture/backend/17-webhook.md §9.2 D8）。 */
export const WEBHOOK_FEATURE = 'webhook';

/** 對外事件的訂閱（`webhook:read`，docs/architecture/backend/17-webhook.md §9）。 */
export const WebhookListRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: '/webhook',
  beforeLoad: requireFeature(WEBHOOK_FEATURE),
  loader: localeScopeLoader(WEBHOOK_LOCALE_SCOPE),
  validateSearch: WebhookSearchQuerySchema,
  search: { middlewares: [stripSearchParams(DEFAULT_WEBHOOK_SEARCH)] },
});

/** 對話框即路由：可分享網址、上一頁＝關閉對話框。 */
export const WebhookCreateRoute = createRoute({
  getParentRoute: () => WebhookListRoute,
  path: 'create',
  validateSearch: WebhookSearchQuerySchema, // 保留列表的查詢條件
});

/** 詳情與投遞紀錄；站內通知 `webhook.disabled` 的連結（route id `webhook.detail`）。 */
export const WebhookDetailRoute = createRoute({
  getParentRoute: () => WebhookListRoute,
  path: '$webhookId',
});
