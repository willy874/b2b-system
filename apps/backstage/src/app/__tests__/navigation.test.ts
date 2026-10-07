import {
  paletteCommandRegistry,
  resetCommandPaletteRegistry,
  searchProviderRegistry,
} from '@b2b-system/web-core/command-palette';
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
import { resetSystemSettingsTabs, systemSettingsTabRegistry } from '@/core/system-settings';

/**
 * 側欄、帳號選單與命令面板的入口都由 feature 登記（docs/architecture/frontend/18-command-palette.md §2），
 * 少了靜態表的編譯期檢查：分類打錯字、入口指向別人的頁面、動作的路徑不屬於宣告的頁面，都靠這支測試抓。
 */
const modules = import.meta.glob<Record<string, unknown>>(
  [
    '../../features/*/permission.ts',
    '../../features/*/navigation.ts',
    '../../features/*/search.ts',
  ],
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
    resetCommandPaletteRegistry();
    resetSystemSettingsTabs();
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

  it('資料提供者與動作宣告的頁面都存在；導覽型動作的路徑落在宣告的頁面上', () => {
    const pages = new Set(getRegisteredPageKeys());
    expect(searchProviderRegistry.keys().length).toBeGreaterThan(0);
    for (const provider of searchProviderRegistry.values()) {
      if (provider.pageKey) expect(pages, provider.key).toContain(provider.pageKey);
    }
    for (const command of paletteCommandRegistry.values()) {
      if (command.pageKey) expect(pages, command.key).toContain(command.pageKey);
      if ('to' in command) expect(resolvePageKey(command.to), command.key).toBe(command.pageKey);
    }
  });

  it('側欄與帳號選單的圖示不重複（看圖示就分得出是哪一頁）', () => {
    const byIcon = new Map<string, string[]>();
    for (const item of navItemRegistry.values()) {
      byIcon.set(item.icon, [...(byIcon.get(item.icon) ?? []), item.pageKey]);
    }
    expect([...byIcon].filter(([, pages]) => pages.length > 1)).toEqual([]);
  });

  it('系統設定的分頁都有登記過的頁面，路徑落在該頁面上（docs/architecture/frontend/02-plugin-system.md §4.5）', () => {
    const pages = new Set(getRegisteredPageKeys());
    expect(systemSettingsTabRegistry.keys().toSorted()).toEqual([
      'general',
      'notification-events',
      'security',
    ]);
    for (const tab of systemSettingsTabRegistry.values()) {
      expect(pages, tab.key).toContain(tab.pageKey);
      expect(resolvePageKey(tab.to), tab.to).toBe(tab.pageKey);
    }
  });

  it('沒有分類是空的（分類裡的頁面全被拿掉時，連分類一起刪）', () => {
    const { groups } = resolveNavigation(navGroupRegistry.values(), navItemRegistry.values());
    expect(groups.filter((group) => group.items.length === 0).map((group) => group.key)).toEqual(
      [],
    );
  });
});
