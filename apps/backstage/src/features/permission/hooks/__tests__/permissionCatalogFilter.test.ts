import { describe, expect, it } from 'vitest';

import type { PermissionCatalog } from '@/shared/api-sdk';

import { filterPermissionCatalog, hasPermissionFilters } from '../permissionCatalogFilter';

const CATALOG = {
  items: ['user:read', 'user:update', 'role:read'].map((key) => ({ key })),
  groups: [
    {
      resource: 'user',
      nameI18nKey: 'permission.resource.user',
      keys: ['user:read', 'user:update'],
    },
    { resource: 'role', nameI18nKey: 'permission.resource.role', keys: ['role:read'] },
  ],
} as unknown as PermissionCatalog;

const NAMES: Record<string, string> = {
  'user:read': '檢視使用者',
  'user:update': '編輯使用者',
  'role:read': '檢視角色',
};
const HELD = new Set(['user:read']);
const run = (filters: Parameters<typeof filterPermissionCatalog>[1]) =>
  filterPermissionCatalog(
    CATALOG,
    filters,
    (key) => HELD.has(key),
    (key) => NAMES[key] ?? key,
  );
const keysOf = (catalog: PermissionCatalog) => catalog.groups.flatMap((group) => group.keys);

describe('filterPermissionCatalog', () => {
  it('沒有篩選 → 原封不動', () => {
    expect(run({})).toBe(CATALOG);
    expect(hasPermissionFilters({})).toBe(false);
  });

  it('關鍵字同時比對名稱與權限鍵（不分大小寫）；沒有符合的資源整組拿掉', () => {
    expect(keysOf(run({ keyword: '檢視' }))).toEqual(['user:read', 'role:read']);
    expect(run({ keyword: 'USER:UP' }).groups.map((group) => group.resource)).toEqual(['user']);
  });

  it('資源與持有狀態同時成立', () => {
    expect(keysOf(run({ resource: ['user'], held: 'notHeld' }))).toEqual(['user:update']);
    expect(keysOf(run({ held: 'held' }))).toEqual(['user:read']);
    expect(run({ resource: ['role'], held: 'held' }).items).toEqual([]);
  });
});
