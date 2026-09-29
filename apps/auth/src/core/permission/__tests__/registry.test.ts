import { beforeEach, describe, expect, it } from 'vitest';

import { definePageKey, PermissionMatch } from '../constants';
import type { PagePermissionRule } from '../constants';
import {
  getRegisteredPageKeys,
  registerPagePermission,
  requirePagePermission,
  resetPagePermissionRegistry,
  resolvePageKey,
  routeBasePath,
} from '../registry';

const ROLE_PAGE = definePageKey('ROLE');
const HOME_PAGE = definePageKey('HOME');

const rule: PagePermissionRule = { access: [], match: PermissionMatch.EVERY };

describe('頁面權限註冊表', () => {
  beforeEach(() => {
    resetPagePermissionRegistry();
  });

  it('重複註冊同一個 page key → 丟例外（不靜默覆寫）', () => {
    registerPagePermission(ROLE_PAGE, { route: '/role', rule });
    expect(() => registerPagePermission(ROLE_PAGE, { route: '/role-2', rule })).toThrow(
      /already registered/,
    );
  });

  it('兩個頁面用同一個 route → 丟例外（resolvePageKey 會有歧義）', () => {
    registerPagePermission(ROLE_PAGE, { route: '/role', rule });
    expect(() => registerPagePermission(definePageKey('OTHER'), { route: '/role', rule })).toThrow(
      /already registered by page ROLE/,
    );
  });

  it('requirePagePermission miss 時丟例外（不 fail-open）', () => {
    expect(() => requirePagePermission(ROLE_PAGE)).toThrow(/not registered/);
  });

  it('resolvePageKey 以 base path 前綴命中子路徑', () => {
    registerPagePermission(ROLE_PAGE, { route: '/role', rule });
    expect(resolvePageKey('/role')).toBe(ROLE_PAGE);
    expect(resolvePageKey('/role/create')).toBe(ROLE_PAGE);
    expect(resolvePageKey('/role/abc/permission')).toBe(ROLE_PAGE);
  });

  it('根路徑只精確命中', () => {
    registerPagePermission(HOME_PAGE, { route: '/', rule });
    expect(resolvePageKey('/')).toBe(HOME_PAGE);
    expect(resolvePageKey('/role')).toBeUndefined();
  });

  it('未註冊的路徑回 undefined（不受管，不是錯誤）', () => {
    expect(resolvePageKey('/auth/login')).toBeUndefined();
  });

  it('routeBasePath 從 route 物件讀 options.path', () => {
    expect(routeBasePath({ options: { path: '/role' } })).toBe('/role');
    expect(() => routeBasePath({ options: {} })).toThrow(/沒有 path/);
  });

  it('getRegisteredPageKeys 回傳已註冊的鍵', () => {
    registerPagePermission(ROLE_PAGE, { route: '/role', rule });
    registerPagePermission(HOME_PAGE, { route: '/', rule });
    expect(new Set(getRegisteredPageKeys())).toEqual(new Set([ROLE_PAGE, HOME_PAGE]));
  });
});
