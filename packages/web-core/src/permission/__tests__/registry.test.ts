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

  it('多個 base path 都命中時取最長的（子頁面規則不被父規則蓋掉）', () => {
    const CREATE_PAGE = definePageKey('ROLE_CREATE');
    registerPagePermission(ROLE_PAGE, { route: '/role', rule });
    registerPagePermission(CREATE_PAGE, { route: '/role/create', rule });
    expect(resolvePageKey('/role/create')).toBe(CREATE_PAGE);
    expect(resolvePageKey('/role/abc')).toBe(ROLE_PAGE);
  });

  it('最長命中與註冊順序無關（子頁面先註冊也一樣）', () => {
    const CREATE_PAGE = definePageKey('ROLE_CREATE');
    registerPagePermission(CREATE_PAGE, { route: '/role/create', rule });
    registerPagePermission(ROLE_PAGE, { route: '/role', rule });
    expect(resolvePageKey('/role/create/step-2')).toBe(CREATE_PAGE);
  });

  it('前綴相同但不是路徑段落的不命中', () => {
    registerPagePermission(ROLE_PAGE, { route: '/role', rule });
    expect(resolvePageKey('/roles')).toBeUndefined();
  });

  it('routeBasePath 沿 getParentRoute 接起上層 path，略過沒有 path 的 layout route', () => {
    const root = { options: {} };
    const layout = { options: { getParentRoute: () => root } };
    const user = { options: { path: '/user/', getParentRoute: () => layout } };
    const create = { options: { path: 'create', getParentRoute: () => user } };
    expect(routeBasePath(create)).toBe('/user/create');
  });

  it('反註冊後頁面不再命中', () => {
    const unregister = registerPagePermission(ROLE_PAGE, { route: '/role', rule });
    unregister();
    expect(resolvePageKey('/role')).toBeUndefined();
  });
});
