import {
  definePageKey,
  PermissionKey,
  PermissionMatch,
  PermissionResource,
  registerPagePermission,
  routeBasePath,
} from '@/core/permission';

import { WebhookCreateRoute, WebhookListRoute } from './routes/pages';

export const WEBHOOK_PAGE = definePageKey('WEBHOOK');
/** 建立對話框是獨立的受管頁面（直接貼網址時要擋下）。 */
export const WEBHOOK_CREATE_PAGE = definePageKey('WEBHOOK_CREATE');

export function registerWebhookPagePermissions(): void {
  registerPagePermission(WEBHOOK_PAGE, {
    route: routeBasePath(WebhookListRoute), // '/webhook'
    rule: {
      resource: PermissionResource.WEBHOOK,
      access: [PermissionKey['webhook:read']],
      match: PermissionMatch.EVERY,
    },
  });
  registerPagePermission(WEBHOOK_CREATE_PAGE, {
    route: routeBasePath(WebhookCreateRoute),
    rule: {
      resource: PermissionResource.WEBHOOK,
      access: [PermissionKey['webhook:read'], PermissionKey['webhook:create']],
      match: PermissionMatch.EVERY,
    },
  });
}
