import {
  navGroupRegistry,
  navItemRegistry,
  resetNavigationRegistry,
  resolveNavigation,
} from '@b2b-system/web-core/navigation';
import { beforeEach, describe, expect, it } from 'vitest';

import { registerNavGroups } from '@/core/navigation';
import {
  getRegisteredPageKeys,
  resetPagePermissionRegistry,
  resolvePageKey,
} from '@/core/permission';

/**
 * 側欄與帳號選單的入口（也是命令面板的「頁面」）都由 feature 登記（docs/architecture/frontend/18-command-palette.md §2），
 * 少了靜態表的編譯期檢查：分類打錯字、入口指向別人的頁面，都靠這支測試抓。
 */
const modules = import.meta.glob<Record<string, unknown>>(
  ['../../features/*/permission.ts', '../../features/*/navigation.ts'],
  { eager: true },
);

function registerAll(): void {
  for (const module of Object.values(modules)) {
    for (const [name, value] of Object.entries(module)) {
      if (name.startsWith('register') && typeof value === 'function') value();
    }
  }
}

describe('選單與命令面板的入口', () => {
  beforeEach(() => {
    resetPagePermissionRegistry();
    resetNavigationRegistry();
    registerNavGroups();
    registerAll();
  });

  it('每個入口都指向登記過的分類（分類打錯字時 resolveNavigation 丟例外）', () => {
    expect(navItemRegistry.keys().length).toBeGreaterThan(0);
    expect(() =>
      resolveNavigation(navGroupRegistry.values(), navItemRegistry.values()),
    ).not.toThrow();
  });

  it('每個入口的路徑都落在它宣告的頁面上（權限過濾與「最近造訪」才會對）', () => {
    const pages = new Set(getRegisteredPageKeys());
    for (const item of navItemRegistry.values()) {
      expect(pages, item.pageKey).toContain(item.pageKey);
      expect(resolvePageKey(item.to), item.to).toBe(item.pageKey);
    }
  });

  it('沒有分類是空的（分類裡的頁面全被拿掉時，連分類一起刪）', () => {
    const { groups } = resolveNavigation(navGroupRegistry.values(), navItemRegistry.values());
    expect(groups.filter((group) => group.items.length === 0).map((group) => group.key)).toEqual(
      [],
    );
  });
});
