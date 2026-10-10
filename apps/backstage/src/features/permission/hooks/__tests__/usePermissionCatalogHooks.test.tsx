import { getEdgeId } from '@b2b-system/ui/TreeEditor';
import { AllProviders } from '@b2b-system/web-core/testing';
import { act, renderHook } from '@testing-library/react';
import { beforeAll, describe, expect, it } from 'vitest';

import type { PermissionCatalog } from '@/shared/api-sdk';
import { initTestI18n } from '@/test/i18n';

import zhTW from '../../locales/zh_TW.json';
import { useFilteredPermissionCatalog } from '../useFilteredPermissionCatalog';
import { usePermissionCatalogTree } from '../usePermissionCatalogTree';

const item = (key: string, includes: string[] = [], requires: string[] = []) => {
  const [resource, action] = key.split(':');
  return { key, resource, nameI18nKey: `permission.${resource}.${action}`, includes, requires };
};

/**
 * 兩個資源的小目錄：`user:update` 包含 `user:read`、`role:update` 包含 `role:read` 並依賴 `user:read`。
 * 名稱是 app 語系包裡真的翻譯（`permission.<resource>.<action>`）。
 */
const CATALOG = {
  items: [
    item('user:read'),
    item('user:update', ['user:read']),
    item('role:read'),
    item('role:update', ['role:read'], ['user:read']),
  ],
  groups: [
    {
      resource: 'user',
      nameI18nKey: 'permission.resource.user',
      keys: ['user:read', 'user:update'],
    },
    {
      resource: 'role',
      nameI18nKey: 'permission.resource.role',
      keys: ['role:read', 'role:update'],
    },
  ],
} as unknown as PermissionCatalog;

const HELD: ReadonlySet<string> = new Set(['user:read', 'user:update']);
const NONE: ReadonlySet<string> = new Set();

const keysOf = (catalog: PermissionCatalog | undefined) =>
  catalog?.groups.flatMap((group) => group.keys);

beforeAll(() => initTestI18n(zhTW));

describe('useFilteredPermissionCatalog', () => {
  it('目錄還沒載入 → undefined', () => {
    const { result } = renderHook(() => useFilteredPermissionCatalog(undefined, {}, HELD), {
      wrapper: AllProviders,
    });
    expect(result.current).toBeUndefined();
  });

  it('關鍵字以目前語系的名稱比對（不只權限鍵）', () => {
    const { result } = renderHook(
      () => useFilteredPermissionCatalog(CATALOG, { keyword: '編輯' }, HELD),
      { wrapper: AllProviders },
    );
    expect(keysOf(result.current)).toEqual(['user:update', 'role:update']);
    expect(result.current?.items.map((permission) => permission.key)).toEqual([
      'user:update',
      'role:update',
    ]);
  });

  it('「持有／未持有」以傳入的持有集合判斷，並可與資源篩選疊加', () => {
    const held = renderHook(
      () => useFilteredPermissionCatalog(CATALOG, { held: 'notHeld' }, HELD),
      { wrapper: AllProviders },
    );
    expect(keysOf(held.result.current)).toEqual(['role:read', 'role:update']);

    const scoped = renderHook(
      () => useFilteredPermissionCatalog(CATALOG, { resource: ['user'], held: 'held' }, HELD),
      { wrapper: AllProviders },
    );
    expect(keysOf(scoped.result.current)).toEqual(['user:read', 'user:update']);
  });

  it('沒有篩選 → 原封不動回傳同一份目錄；輸入不變時結果穩定', () => {
    const hook = renderHook(() => useFilteredPermissionCatalog(CATALOG, {}, HELD), {
      wrapper: AllProviders,
    });
    expect(hook.result.current).toBe(CATALOG);
    const first = hook.result.current;
    hook.rerender();
    expect(hook.result.current).toBe(first);
  });
});

function renderTree(options: Partial<Parameters<typeof usePermissionCatalogTree>[0]> = {}) {
  return renderHook(() => usePermissionCatalogTree({ catalog: CATALOG, held: HELD, ...options }), {
    wrapper: AllProviders,
  });
}

describe('usePermissionCatalogTree（docs/architecture/iam/02-permission-catalog.md §9）', () => {
  it('每個資源一組，分組標題是目前語系的資源名稱；跨資源的依賴畫成虛線', () => {
    const { result } = renderTree();
    expect(result.current.layout.groups.map((group) => [group.id, group.label])).toEqual([
      ['user', '使用者'],
      ['role', '角色'],
    ]);
    expect(result.current.layout.nodes.map((node) => node.id)).toEqual([
      'user:read',
      'user:update',
      'role:read',
      'role:update',
    ]);
    expect(result.current.layout.edges).toContainEqual({
      source: 'user:read',
      target: 'role:update',
      variant: 'dashed',
    });
  });

  it('兩端都持有的連線才亮', () => {
    const { result } = renderTree();
    expect([...result.current.heldEdges]).toEqual([
      getEdgeId({ source: 'user:read', target: 'user:update' }),
    ]);
  });

  it('只畫篩選後的節點，但說明面板的關係來自完整目錄', () => {
    const visible = {
      items: CATALOG.items.filter((permission) => permission.resource === 'user'),
      groups: CATALOG.groups.filter((group) => group.resource === 'user'),
    } as PermissionCatalog;
    const { result } = renderTree({ visible, selectedKey: 'user:read' });

    expect(result.current.layout.nodes.map((node) => node.id)).toEqual([
      'user:read',
      'user:update',
    ]);
    expect(result.current.detail?.dependents).toEqual(['user:update', 'role:update']);
  });

  it('點選的鍵 → 說明：持有與否、直接包含與依賴、被誰帶出、（遞迴）帶來的鍵', () => {
    const { result } = renderTree({ selectedKey: 'role:update' });
    expect(result.current.selectedKey).toBe('role:update');
    expect(result.current.detail).toMatchObject({
      item: { key: 'role:update' },
      held: false,
      includes: ['role:read'],
      requires: ['user:read'],
      dependents: [],
    });
    expect(result.current.detail?.grants.toSorted()).toEqual(['role:read', 'user:read']);
    expect([...result.current.path.nodeIds].toSorted()).toEqual(['role:read', 'user:read']);
  });

  it('網址上的鍵不在目錄裡 → 當成沒選，沒有說明也沒有強調的路徑', () => {
    const { result } = renderTree({ selectedKey: 'ghost:read' });
    expect(result.current.selectedKey).toBeUndefined();
    expect(result.current.detail).toBeUndefined();
    expect(result.current.path.nodeIds.size).toBe(0);
  });

  it('滑過優先於點選；移開後回到點選的鍵', () => {
    const { result } = renderTree({ selectedKey: 'user:read', held: NONE });
    act(() => result.current.setFocusKey('user:update'));
    expect(result.current.detail?.item.key).toBe('user:update');
    expect(result.current.selectedKey).toBe('user:read');

    act(() => result.current.setFocusKey(undefined));
    expect(result.current.detail?.item.key).toBe('user:read');
  });

  it('nameOf：目錄裡的鍵顯示翻譯，不認得的鍵退回權限鍵', () => {
    const { result } = renderTree();
    expect(result.current.nameOf('user:read')).toBe('檢視使用者');
    expect(result.current.nameOf('ghost:read')).toBe('ghost:read');
  });
});
