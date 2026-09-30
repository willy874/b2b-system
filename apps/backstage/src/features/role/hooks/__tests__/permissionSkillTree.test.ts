import { describe, expect, it } from 'vitest';

import type { Permission, PermissionGroup } from '@/shared/api-sdk';

import {
  activeEdgeIds,
  layoutSkillTree,
  permissionClosure,
  prerequisitePath,
  skillState,
  toggleSkill,
} from '../permissionSkillTree';

const item = (key: string, includes: string[] = [], requires: string[] = []): Permission =>
  ({
    id: key,
    key,
    resource: key.split(':')[0],
    action: key.split(':')[1],
    nameI18nKey: `permission.${key}`,
    description: null,
    sortOrder: 0,
    includes,
    requires,
  }) as Permission;

/** 與後端依賴樹相同的一小段（docs/rbac/02-permission-catalog.md §9.1）。 */
const CATALOG = [
  item('file:access'),
  item('file:read', ['file:access']),
  item('file:update', ['file:read']),
  item('file:delete', ['file:update']),
  item('file:share', ['file:read']),
  item('role:read'),
  item('user:read'),
  item('user:assignRole', ['user:read'], ['role:read']),
];
const GROUPS = [
  {
    resource: 'file',
    nameI18nKey: 'file',
    keys: ['file:access', 'file:read', 'file:update', 'file:delete', 'file:share'],
  },
  { resource: 'role', nameI18nKey: 'role', keys: ['role:read'] },
  { resource: 'user', nameI18nKey: 'user', keys: ['user:read', 'user:assignRole'] },
] as PermissionGroup[];
const ALL = () => true;
const NONE = () => false;
const EXCEPT_SHARE = (key: string) => key !== 'file:share';

describe('角色權限技能樹（permissionSkillTree）', () => {
  it('閉包：刪除 ⇒ 編輯 ⇒ 檢視 ⇒ 使用檔案管理器', () => {
    expect([...permissionClosure(CATALOG, ['file:delete'])].toSorted()).toEqual([
      'file:access',
      'file:delete',
      'file:read',
      'file:update',
    ]);
  });

  it('狀態：明確、已包含、可授予、無法授予（反提權）', () => {
    const explicit = new Set(['file:update']);
    expect(skillState(CATALOG, 'file:update', explicit, EXCEPT_SHARE)).toBe('explicit');
    expect(skillState(CATALOG, 'file:read', explicit, EXCEPT_SHARE)).toBe('implied');
    expect(skillState(CATALOG, 'file:delete', explicit, EXCEPT_SHARE)).toBe('available');
    expect(skillState(CATALOG, 'file:share', explicit, EXCEPT_SHARE)).toBe('unavailable');
  });

  it('點上層：只把上層加進明確的鍵，前置由閉包帶出', () => {
    const result = toggleSkill(CATALOG, 'file:delete', new Set(), ALL);
    expect(result).toEqual({ kind: 'changed', next: new Set(['file:delete']) });
  });

  it('互鎖：有上層包含時不能取消前置（明確的也一樣），告知是哪個上層', () => {
    const explicit = new Set(['file:read', 'file:delete']);
    expect(toggleSkill(CATALOG, 'file:read', explicit, ALL)).toEqual({
      kind: 'blocked',
      by: ['file:delete'],
    });
    expect(toggleSkill(CATALOG, 'file:access', explicit, ALL)).toEqual({
      kind: 'blocked',
      by: ['file:read', 'file:delete'],
    });
  });

  it('取消沒有上層的明確鍵；原本明確勾過的前置保留', () => {
    const result = toggleSkill(CATALOG, 'file:delete', new Set(['file:read', 'file:delete']), ALL);
    expect(result).toEqual({ kind: 'changed', next: new Set(['file:read']) });
  });

  it('操作者沒有的權限不能點亮，但已有的仍可以取消', () => {
    expect(toggleSkill(CATALOG, 'file:share', new Set(), NONE)).toEqual({ kind: 'unavailable' });
    expect(toggleSkill(CATALOG, 'file:share', new Set(['file:share']), NONE)).toEqual({
      kind: 'changed',
      next: new Set(),
    });
  });

  it('版面：每個資源一組；子能力是組內的實線、跨資源的依賴是虛線；基礎在下（BT）', () => {
    const layout = layoutSkillTree(CATALOG, GROUPS, (group) => group.resource);
    expect(layout.groups.map((group) => group.id)).toEqual(['file', 'role', 'user']);
    expect(layout.edges).toContainEqual({ source: 'file:read', target: 'file:update' });
    expect(layout.edges).toContainEqual({
      source: 'role:read',
      target: 'user:assignRole',
      variant: 'dashed',
    });
    const y = (key: string) => layout.nodes.find((node) => node.id === key)?.position?.y ?? 0;
    expect(y('file:read')).toBeGreaterThan(y('file:update'));
    expect(y('file:update')).toBeGreaterThan(y('file:delete'));
  });

  it('前置路徑與已學會的連線', () => {
    const { edges } = layoutSkillTree(CATALOG, GROUPS, (group) => group.resource);
    const path = prerequisitePath(CATALOG, 'user:assignRole', edges);
    expect([...path.nodeIds].toSorted()).toEqual(['role:read', 'user:read']);
    expect([...path.edgeIds].toSorted()).toEqual([
      'role:read->user:assignRole',
      'user:read->user:assignRole',
    ]);
    const lit = permissionClosure(CATALOG, ['file:update']);
    expect([...activeEdgeIds(edges, lit)].toSorted()).toEqual([
      'file:access->file:read',
      'file:read->file:update',
    ]);
  });
});
