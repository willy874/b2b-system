/**
 * 權限目錄的程式碼來源。
 * **唯一事實來源是 `docs/rbac/02-permission-catalog.md`**；改這裡必須同時改文件
 * （有測試比對兩者）。
 */
export const PERMISSION_SEED = [
  // resource, action, i18n key, sort
  ['user', 'create', 'permission.user.create', 100],
  ['user', 'read', 'permission.user.read', 101],
  ['user', 'update', 'permission.user.update', 102],
  ['user', 'delete', 'permission.user.delete', 103],
  ['user', 'assignRole', 'permission.user.assignRole', 104],
  ['user', 'resetPassword', 'permission.user.resetPassword', 105],

  ['role', 'create', 'permission.role.create', 200],
  ['role', 'read', 'permission.role.read', 201],
  ['role', 'update', 'permission.role.update', 202],
  ['role', 'delete', 'permission.role.delete', 203],
  ['role', 'grantPermission', 'permission.role.grantPermission', 204],

  ['permission', 'read', 'permission.permission.read', 300],
  ['auditLog', 'read', 'permission.auditLog.read', 400],
  ['system', 'read', 'permission.system.read', 500],
  ['system', 'update', 'permission.system.update', 501],
] as const satisfies ReadonlyArray<readonly [string, string, string, number]>;

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

export const PERMISSION_RESOURCES = [...new Set(PERMISSION_SEED.map(([resource]) => resource))];

export function isPermissionKey(value: string): value is PermissionKey {
  return (ALL_PERMISSION_KEYS as string[]).includes(value);
}
