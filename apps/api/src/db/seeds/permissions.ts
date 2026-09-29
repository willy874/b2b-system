/**
 * 權限目錄的程式碼來源。
 * **唯一事實來源是 `docs/rbac/02-permission-catalog.md`**；改這裡必須同時改文件
 * （有測試比對兩者）。
 */
export const PERMISSION_SEED = [
  // resource, action, i18n key, sort, scope（docs/adr/0018-workspace-tenancy.md D2）
  ['user', 'create', 'permission.user.create', 100, 'platform'],
  ['user', 'read', 'permission.user.read', 101, 'platform'],
  ['user', 'update', 'permission.user.update', 102, 'platform'],
  ['user', 'delete', 'permission.user.delete', 103, 'platform'],
  ['user', 'assignRole', 'permission.user.assignRole', 104, 'platform'],
  ['user', 'resetPassword', 'permission.user.resetPassword', 105, 'platform'],

  ['role', 'create', 'permission.role.create', 200, 'platform'],
  ['role', 'read', 'permission.role.read', 201, 'platform'],
  ['role', 'update', 'permission.role.update', 202, 'platform'],
  ['role', 'delete', 'permission.role.delete', 203, 'platform'],
  ['role', 'grantPermission', 'permission.role.grantPermission', 204, 'platform'],

  ['permission', 'read', 'permission.permission.read', 300, 'platform'],
  ['auditLog', 'read', 'permission.auditLog.read', 400, 'platform'],
  ['system', 'read', 'permission.system.read', 500, 'platform'],
  ['system', 'update', 'permission.system.update', 501, 'platform'],

  ['approval', 'read', 'permission.approval.read', 600, 'platform'],
  ['approval', 'review', 'permission.approval.review', 601, 'platform'],

  ['file', 'create', 'permission.file.create', 700, 'workspace'],
  ['file', 'read', 'permission.file.read', 701, 'workspace'],
  ['file', 'update', 'permission.file.update', 702, 'workspace'],
  ['file', 'delete', 'permission.file.delete', 703, 'workspace'],
  ['file', 'access', 'permission.file.access', 704, 'workspace'],
  ['file', 'share', 'permission.file.share', 705, 'workspace'],

  ['job', 'read', 'permission.job.read', 800, 'platform'],
  ['job', 'retry', 'permission.job.retry', 801, 'platform'],

  ['workspace', 'create', 'permission.workspace.create', 900, 'platform'],
  ['workspace', 'read', 'permission.workspace.read', 901, 'platform'],
  ['workspace', 'update', 'permission.workspace.update', 902, 'platform'],
  ['workspace', 'delete', 'permission.workspace.delete', 903, 'platform'],

  ['workspaceMember', 'read', 'permission.workspaceMember.read', 1000, 'workspace'],
  ['workspaceMember', 'create', 'permission.workspaceMember.create', 1001, 'workspace'],
  ['workspaceMember', 'delete', 'permission.workspaceMember.delete', 1002, 'workspace'],
  ['workspaceMember', 'assignRole', 'permission.workspaceMember.assignRole', 1003, 'workspace'],
] as const satisfies ReadonlyArray<
  readonly [string, string, string, number, 'platform' | 'workspace']
>;

type SeedList = typeof PERMISSION_SEED;

/** 逐筆映射（不是 resource × action 的笛卡兒積）。 */
export type PermissionKey = {
  [Index in keyof SeedList]: SeedList[Index] extends readonly [
    infer Resource extends string,
    infer Action extends string,
    ...unknown[],
  ]
    ? `${Resource}:${Action}`
    : never;
}[number];

export const ALL_PERMISSION_KEYS = PERMISSION_SEED.map(
  ([resource, action]) => `${resource}:${action}`,
) as PermissionKey[];

/** 權限鍵 → 範圍（`platform` 由全域角色持有；`workspace` 只在指派的工作區有效）。 */
export const PERMISSION_SCOPE_OF = Object.fromEntries(
  PERMISSION_SEED.map(([resource, action, , , scope]) => [`${resource}:${action}`, scope]),
) as Record<PermissionKey, 'platform' | 'workspace'>;

export const PLATFORM_PERMISSION_KEYS = ALL_PERMISSION_KEYS.filter(
  (key) => PERMISSION_SCOPE_OF[key] === 'platform',
);

export const WORKSPACE_PERMISSION_KEYS = ALL_PERMISSION_KEYS.filter(
  (key) => PERMISSION_SCOPE_OF[key] === 'workspace',
);

export const PERMISSION_RESOURCES = [...new Set(PERMISSION_SEED.map(([resource]) => resource))];

export function isPermissionKey(value: string): value is PermissionKey {
  return (ALL_PERMISSION_KEYS as string[]).includes(value);
}
