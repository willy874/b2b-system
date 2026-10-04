import { beforeEach, describe, expect, it } from 'vitest';

import { AUDIT_LOG_PAGE, registerAuditLogPagePermissions } from '@/features/audit-log';
import { FEATURE_FLAG_PAGE, registerFeatureFlagPagePermissions } from '@/features/feature-flag';
import { HOME_PAGE, registerHomePagePermissions } from '@/features/home';
import { JOB_PAGE, registerJobPagePermissions } from '@/features/job';
import {
  PLATFORM_ADMIN_PAGE,
  registerPlatformAdminPagePermissions,
} from '@/features/platform-admin';
import { registerTenantPagePermissions, TENANT_PAGE } from '@/features/tenant';

import { getRegisteredPageKeys, resetPagePermissionRegistry } from '../registry';

/** 取代靜態表原本提供的編譯期完整性（docs/architecture/frontend/02-plugin-system.md §8 的代價緩解）；apps/platform 的 feature 清單。 */
describe('註冊表完整性', () => {
  beforeEach(() => {
    resetPagePermissionRegistry();
  });

  it('註冊的頁面鍵集合等於所有 feature 匯出的頁面鍵之聯集', () => {
    registerHomePagePermissions();
    registerTenantPagePermissions();
    registerPlatformAdminPagePermissions();
    registerAuditLogPagePermissions();
    registerJobPagePermissions();
    registerFeatureFlagPagePermissions();

    expect(new Set(getRegisteredPageKeys())).toEqual(
      new Set([
        HOME_PAGE,
        TENANT_PAGE,
        PLATFORM_ADMIN_PAGE,
        AUDIT_LOG_PAGE,
        JOB_PAGE,
        FEATURE_FLAG_PAGE,
      ]),
    );
  });
});
