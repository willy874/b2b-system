import { beforeEach, describe, expect, it } from 'vitest';

import { definePageKey } from '../../permission';
import {
  navGroupRegistry,
  navItemRegistry,
  registerNavGroup,
  registerNavItem,
  resetNavigationRegistry,
  resolveNavigation,
} from '../registry';
import type { NavItem } from '../registry';

function item(overrides: Partial<NavItem> & Pick<NavItem, 'pageKey'>): NavItem {
  return {
    to: '/x',
    labelKey: 'menu.x',
    testId: 'menu-x',
    icon: 'home',
    order: 100,
    ...overrides,
  };
}

const resolve = () => resolveNavigation(navGroupRegistry.values(), navItemRegistry.values());

beforeEach(() => resetNavigationRegistry());

describe('選單註冊表（docs/architecture/frontend/18-command-palette.md §2）', () => {
  it('分類與項目各自依 order 排序；沒有分類的列在最上方，帳號選單的另外一組', () => {
    registerNavGroup({ key: 'system', labelKey: 'g.system', testId: 'g-system', order: 200 });
    registerNavGroup({ key: 'people', labelKey: 'g.people', testId: 'g-people', order: 100 });
    registerNavItem(item({ pageKey: definePageKey('role'), group: 'people', order: 200 }));
    registerNavItem(item({ pageKey: definePageKey('user'), group: 'people', order: 100 }));
    registerNavItem(item({ pageKey: definePageKey('job'), group: 'system', order: 100 }));
    registerNavItem(item({ pageKey: definePageKey('home'), order: 100 }));
    registerNavItem(item({ pageKey: definePageKey('profile'), placement: 'account', order: 100 }));

    const { topItems, groups, accountItems } = resolve();
    expect(topItems.map((entry) => entry.pageKey)).toEqual(['home']);
    expect(groups.map((group) => [group.key, group.items.map((entry) => entry.pageKey)])).toEqual([
      ['people', ['user', 'role']],
      ['system', ['job']],
    ]);
    expect(accountItems.map((entry) => entry.pageKey)).toEqual(['profile']);
  });

  it('項目指向沒有登記的分類 → 讀取時丟例外，不讓頁面默默消失', () => {
    registerNavItem(item({ pageKey: definePageKey('user'), group: 'peple' }));
    expect(resolve).toThrow('Nav group not registered: peple');
  });

  it('同一個頁面重複登記、帳號選單的項目指定分類 → 丟例外', () => {
    registerNavItem(item({ pageKey: definePageKey('user') }));
    expect(() => registerNavItem(item({ pageKey: definePageKey('user') }))).toThrow(
      'already registered',
    );
    expect(() =>
      registerNavItem(
        item({ pageKey: definePageKey('profile'), placement: 'account', group: 'x' }),
      ),
    ).toThrow('帳號選單');
  });

  it('反註冊後項目消失（feature 卸載）', () => {
    const dispose = registerNavItem(item({ pageKey: definePageKey('home') }));
    dispose();
    expect(resolve().topItems).toEqual([]);
  });
});
