import { and, computed, defineType, direct, from, subjectKey, union } from '@/core/authz';
import type { ObjectRef, TypeDefinition } from '@/core/authz';

/**
 * 檔案管理器在關係圖上的型別（docs/rbac/07-resource-grants.md §2.1）。
 *
 * - 等級：高的蘊含低的，沿 `inherits_from` 往下流；中斷繼承的資料夾沒有 `inherits_from` 邊。
 * - 動作（`can_*`）：等級 ∪ 租戶上的全域權限鍵（07 §3.2 的 `has()`）。
 * - 規則 A：能在這裡建立 ⇒ 能編輯自己在這裡建立的（`can_update_own`）；項目本身的改名／刪除看上層（07 §4）。
 * - 根目錄不是資料夾，只由全域權限決定：頂層資料夾的 `parent` 指向 `fileRoot:root`。
 */

/**
 * 資料夾授權的對象：個別使用者、所有人（everyone）、角色的持有者、群組的成員（G4）。
 * 群組的授權由共用對話框寫入（G4 的前端）；模型先允許，解析才會認得。
 */
const GRANTEES = ['user', 'user:*', 'role#holder', 'group#member'] as const;

export const FILE_ROOT_OBJECT = { type: 'fileRoot', id: 'root' } as const;

/** 位置（資料夾或根目錄）上的動作；兩個型別都有同名的關係。 */
const LOCATION_ACTIONS = {
  can_read: 'file:read',
  can_create: 'file:create',
  can_update: 'file:update',
  can_delete: 'file:delete',
  can_share: 'file:share',
} as const;

/** 項目本身（檔案、資料夾）的改名／移動與刪除。 */
const ITEM_RELATIONS = {
  can_rename: union(
    from('parent', 'can_update'),
    and(computed('owner'), from('parent', 'can_update_own')),
  ),
  can_remove: union(
    from('parent', 'can_delete'),
    and(computed('owner'), from('parent', 'can_update_own')),
  ),
};

/** 反提權比對的能力：位置上的五個動作（等級是取得它們的途徑；`can_update_own` 由它們推出）。 */
const LOCATION_CAPABILITIES = Object.keys(LOCATION_ACTIONS);

export const FILE_ROOT_TYPE: TypeDefinition = defineType(
  FILE_ROOT_OBJECT.type,
  {
    tenant: direct('tenant'),
    ...Object.fromEntries(
      Object.entries(LOCATION_ACTIONS).map(([relation, key]) => [relation, from('tenant', key)]),
    ),
    can_update_own: union(computed('can_update'), computed('can_create')),
  },
  { capabilities: LOCATION_CAPABILITIES },
);

export const FILE_FOLDER_TYPE: TypeDefinition = defineType(
  'fileFolder',
  {
    tenant: direct('tenant'),
    parent: direct('fileFolder', FILE_ROOT_OBJECT.type),
    inherits_from: direct('fileFolder'),
    owner: direct('user'),

    manager: union(direct(...GRANTEES), from('inherits_from', 'manager')),
    editor: union(direct(...GRANTEES), computed('manager'), from('inherits_from', 'editor')),
    contributor: union(
      direct(...GRANTEES),
      computed('editor'),
      from('inherits_from', 'contributor'),
    ),
    viewer: union(direct(...GRANTEES), computed('contributor'), from('inherits_from', 'viewer')),

    can_read: union(computed('viewer'), from('tenant', LOCATION_ACTIONS.can_read)),
    can_create: union(computed('contributor'), from('tenant', LOCATION_ACTIONS.can_create)),
    can_update: union(computed('editor'), from('tenant', LOCATION_ACTIONS.can_update)),
    can_delete: union(computed('editor'), from('tenant', LOCATION_ACTIONS.can_delete)),
    can_share: union(computed('manager'), from('tenant', LOCATION_ACTIONS.can_share)),
    can_update_own: union(computed('can_update'), computed('can_create')),

    ...ITEM_RELATIONS,
  },
  { capabilities: LOCATION_CAPABILITIES },
);

export const FILE_TYPE: TypeDefinition = defineType('file', {
  parent: direct('fileFolder', FILE_ROOT_OBJECT.type),
  owner: direct('user'),
  can_read: from('parent', 'can_read'),
  ...ITEM_RELATIONS,
});

export const FILE_AUTHZ_TYPES = [FILE_ROOT_TYPE, FILE_FOLDER_TYPE, FILE_TYPE] as const;

const ROOT_KEY = subjectKey(FILE_ROOT_OBJECT.type, FILE_ROOT_OBJECT.id);

/** 位置（資料夾 id；null 是根目錄）在圖上的物件。 */
export function locationObject(location: string | null): ObjectRef {
  return location === null ? FILE_ROOT_OBJECT : { type: 'fileFolder', id: location };
}

/** 項目（檔案或資料夾）本身的臨時邊：所在位置與建立者。 */
export function itemEdges(
  location: string | null,
  createdBy: string | null,
): Record<string, string[]> {
  const parent = location === null ? ROOT_KEY : subjectKey('fileFolder', location);
  return { parent: [parent], owner: createdBy ? [subjectKey('user', createdBy)] : [] };
}
