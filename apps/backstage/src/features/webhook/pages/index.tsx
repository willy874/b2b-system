import { lazyRouteComponent } from '@tanstack/react-router';

export const AsyncWebhookListPage = lazyRouteComponent(() => import('./WebhookList/page'));
export const AsyncWebhookCreatePage = lazyRouteComponent(() => import('./WebhookCreate/page'));
export const AsyncWebhookDetailPage = lazyRouteComponent(() => import('./WebhookDetail/page'));
