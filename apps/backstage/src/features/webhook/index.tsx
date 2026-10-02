import * as Pages from './pages';
import * as Routes from './routes';

Routes.WebhookListRoute.update({ component: Pages.AsyncWebhookListPage });
Routes.WebhookCreateRoute.update({ component: Pages.AsyncWebhookCreatePage });
Routes.WebhookDetailRoute.update({ component: Pages.AsyncWebhookDetailPage });

export { Routes };
export { WEBHOOK_FEATURE } from './routes';
export { registerWebhookPagePermissions, WEBHOOK_CREATE_PAGE, WEBHOOK_PAGE } from './permission';
export { appContextPlugin as webhookFeaturePlugin } from './plugin';
