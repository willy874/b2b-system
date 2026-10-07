import {
  registerPaletteCommand,
  registerSearchProvider,
  SEARCH_RESULT_LIMIT,
} from '@b2b-system/web-core/command-palette';

import { fetchWebhookListQuery } from '@/apis/webhook/get-webhook-list/fetcher';
import { routeBasePath } from '@/core/permission';

import { WEBHOOK_CREATE_PAGE, WEBHOOK_PAGE } from './permission';
import { WebhookCreateRoute } from './routes/pages';

/**
 * 命令面板：搜尋 Webhook 與「建立 Webhook」（docs/architecture/frontend/18-command-palette.md §4）。
 * 這個 feature 是可啟用的：租戶沒啟用時不會登記，面板裡就沒有這一組。
 */
export function registerWebhookSearch(): void {
  registerSearchProvider({
    key: 'webhook',
    labelI18nKey: 'menu.webhook',
    icon: 'network',
    pageKey: WEBHOOK_PAGE,
    order: 600,
    search: async (keyword, signal) => {
      const { items } = await fetchWebhookListQuery({
        params: { offset: 0, limit: SEARCH_RESULT_LIMIT, keyword },
        signal,
      });
      return items.map((webhook) => ({
        id: webhook.id,
        label: webhook.name,
        description: webhook.targets[0]?.url,
        link: { route: 'webhook.detail', params: { webhookId: webhook.id } },
      }));
    },
  });
  registerPaletteCommand({
    key: 'webhook.create',
    labelI18nKey: 'commandPalette.command.createWebhook',
    icon: 'plus',
    pageKey: WEBHOOK_CREATE_PAGE,
    order: 600,
    to: routeBasePath(WebhookCreateRoute),
  });
}
