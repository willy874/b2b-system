import {
  definePageKey,
  PermissionKey,
  PermissionMatch,
  PermissionResource,
  registerPagePermission,
  routeBasePath,
} from '@/core/permission';

import { JobListRoute } from './routes/pages';

export const JOB_PAGE = definePageKey('JOB');

export function registerJobPagePermissions(): void {
  registerPagePermission(JOB_PAGE, {
    route: routeBasePath(JobListRoute),
    rule: {
      resource: PermissionResource.JOB,
      access: [PermissionKey['job:read']],
      match: PermissionMatch.EVERY,
    },
  });
}
