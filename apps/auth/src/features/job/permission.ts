import {
  definePageKey,
  PermissionKey,
  PermissionMatch,
  PermissionResource,
  registerPagePermission,
  routeBasePath,
} from '@/core/permission';

import { JobListRoute } from './routes/pages';

/** 背景工作監控；`platformJob:retry` 另外控制重試（不在 CRUD 派生內，見 hooks/useJobPermission.ts）。 */
export const JOB_PAGE = definePageKey('JOB');

export function registerJobPagePermissions(): void {
  registerPagePermission(JOB_PAGE, {
    route: routeBasePath(JobListRoute),
    rule: {
      resource: PermissionResource.PLATFORM_JOB,
      access: [PermissionKey['platformJob:read']],
      match: PermissionMatch.EVERY,
    },
  });
}
