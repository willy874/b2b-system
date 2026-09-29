import { beforeEach, describe, expect, it } from 'vitest';

import { HOME_PAGE, registerHomePagePermissions } from '@/features/home';
import { registerTenantPagePermissions, TENANT_PAGE } from '@/features/tenant';

import { getRegisteredPageKeys, resetPagePermissionRegistry } from '../registry';

/** 取代靜態表原本提供的編譯期完整性（ADR-0001 的代價緩解）；apps/auth 的 feature 清單。 */
describe('註冊表完整性', () => {
  beforeEach(() => {
    resetPagePermissionRegistry();
  });

  it('註冊的頁面鍵集合等於所有 feature 匯出的頁面鍵之聯集', () => {
    registerHomePagePermissions();
    registerTenantPagePermissions();

    expect(new Set(getRegisteredPageKeys())).toEqual(new Set([HOME_PAGE, TENANT_PAGE]));
  });
});
