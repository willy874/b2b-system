import { beforeEach, describe, expect, it } from 'vitest';

import { registerAccountPagePermissions, PREFERENCE_PAGE, PROFILE_PAGE } from '@/features/account';
import { AUDIT_LOG_PAGE, registerAuditLogPagePermissions } from '@/features/audit-log';
import { FILE_PAGE, registerFilePagePermissions } from '@/features/file';
import { HOME_PAGE, registerHomePagePermissions } from '@/features/home';
import {
  IDENTITY_PROVIDER_PAGE,
  registerIdentityProviderPagePermissions,
} from '@/features/identity-provider';
import {
  NOTIFICATION_EVENT_PAGE,
  NOTIFICATION_OVERVIEW_PAGE,
  NOTIFICATION_PAGE,
  registerNotificationPagePermissions,
} from '@/features/notification';
import { PERMISSION_PAGE, registerPermissionPagePermissions } from '@/features/permission';
import { registerRolePagePermissions, ROLE_CREATE_PAGE, ROLE_PAGE } from '@/features/role';
import { registerTrashPagePermissions, TRASH_PAGE } from '@/features/trash';
import { registerUserPagePermissions, USER_CREATE_PAGE, USER_PAGE } from '@/features/user';

import { getRegisteredPageKeys, resetPagePermissionRegistry, resolvePageKey } from '../registry';

/** 取代靜態表原本提供的編譯期完整性（ADR-0001 的代價緩解）。 */
describe('註冊表完整性', () => {
  beforeEach(() => {
    resetPagePermissionRegistry();
  });

  it('註冊的頁面鍵集合等於所有 feature 匯出的頁面鍵之聯集', () => {
    registerHomePagePermissions();
    registerUserPagePermissions();
    registerRolePagePermissions();
    registerPermissionPagePermissions();
    registerAuditLogPagePermissions();
    registerAccountPagePermissions();
    registerFilePagePermissions();
    registerIdentityProviderPagePermissions();
    registerTrashPagePermissions();
    registerNotificationPagePermissions();

    expect(new Set(getRegisteredPageKeys())).toEqual(
      new Set([
        HOME_PAGE,
        USER_PAGE,
        USER_CREATE_PAGE,
        ROLE_PAGE,
        ROLE_CREATE_PAGE,
        PERMISSION_PAGE,
        AUDIT_LOG_PAGE,
        PROFILE_PAGE,
        PREFERENCE_PAGE,
        FILE_PAGE,
        IDENTITY_PROVIDER_PAGE,
        TRASH_PAGE,
        NOTIFICATION_PAGE,
        NOTIFICATION_EVENT_PAGE,
        NOTIFICATION_OVERVIEW_PAGE,
      ]),
    );
  });

  it('子頁面（建立對話框）解析到自己的頁面鍵，不被列表頁的規則蓋掉', () => {
    registerUserPagePermissions();
    registerRolePagePermissions();

    expect(resolvePageKey('/user/create')).toBe(USER_CREATE_PAGE);
    expect(resolvePageKey('/user')).toBe(USER_PAGE);
    expect(resolvePageKey('/role/create')).toBe(ROLE_CREATE_PAGE);
    expect(resolvePageKey('/role')).toBe(ROLE_PAGE);
  });
});
