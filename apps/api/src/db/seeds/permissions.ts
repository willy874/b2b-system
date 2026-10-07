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

  ['approval', 'read', 'permission.approval.read', 600],
  ['approval', 'review', 'permission.approval.review', 601],

  ['file', 'create', 'permission.file.create', 700],
  ['file', 'read', 'permission.file.read', 701],
  ['file', 'update', 'permission.file.update', 702],
  ['file', 'delete', 'permission.file.delete', 703],
  ['file', 'access', 'permission.file.access', 704],
  ['file', 'share', 'permission.file.share', 705],
  // 看得到別人的個人資料夾（鎖住、可申請存取）；讀內容另要授權或全域 file:read（docs/rbac/07-resource-grants.md §12）
  ['file', 'listPersonal', 'permission.file.listPersonal', 706],

  ['job', 'read', 'permission.job.read', 800],
  ['job', 'retry', 'permission.job.retry', 801],

  // 外部 IdP 連線（docs/architecture/04-sso.md §12.2 D8、D9）
  ['identityProvider', 'create', 'permission.identityProvider.create', 1100],
  ['identityProvider', 'read', 'permission.identityProvider.read', 1101],
  ['identityProvider', 'update', 'permission.identityProvider.update', 1102],
  ['identityProvider', 'delete', 'permission.identityProvider.delete', 1103],

  // 群組（docs/rbac/01-domain-model.md §9.3 D11、D12）
  ['group', 'create', 'permission.group.create', 1200],
  ['group', 'read', 'permission.group.read', 1201],
  ['group', 'update', 'permission.group.update', 1202],
  ['group', 'delete', 'permission.group.delete', 1203],
  ['group', 'assignRole', 'permission.group.assignRole', 1204],

  // 授權說明：別人的有效權限與來源、資料夾存取的路徑（docs/rbac/01-domain-model.md §9.3 D14）
  ['authz', 'explain', 'permission.authz.explain', 1300],

  // 服務帳號與它的 API token（docs/architecture/06-external-api.md §9.2 D14）
  ['serviceAccount', 'create', 'permission.serviceAccount.create', 1400],
  ['serviceAccount', 'read', 'permission.serviceAccount.read', 1401],
  ['serviceAccount', 'update', 'permission.serviceAccount.update', 1402],
  ['serviceAccount', 'delete', 'permission.serviceAccount.delete', 1403],

  // Webhook 訂閱與投遞紀錄（docs/architecture/backend/17-webhook.md §9.2 D6）
  ['webhook', 'create', 'permission.webhook.create', 1500],
  ['webhook', 'read', 'permission.webhook.read', 1501],
  ['webhook', 'update', 'permission.webhook.update', 1502],
  ['webhook', 'delete', 'permission.webhook.delete', 1503],

  // 標籤的定義（docs/architecture/backend/18-tag.md §7.2 D5）；貼與移除跟著目標資源的編輯權限，沒有權限鍵
  ['tag', 'create', 'permission.tag.create', 1600],
  ['tag', 'update', 'permission.tag.update', 1601],
  ['tag', 'delete', 'permission.tag.delete', 1602],

  // 通知總覽：租戶內所有人的站內通知（docs/architecture/backend/19-announcement.md §9.2 D1、D2）
  ['notification', 'read', 'permission.notification.read', 1700],

  // 公告與排程通知（docs/architecture/backend/19-announcement.md §9.2 D15）；publish 獨立於 update：能寫草稿的人不一定能對全租戶發話
  ['announcement', 'create', 'permission.announcement.create', 1800],
  ['announcement', 'read', 'permission.announcement.read', 1801],
  ['announcement', 'update', 'permission.announcement.update', 1802],
  ['announcement', 'delete', 'permission.announcement.delete', 1803],
  ['announcement', 'publish', 'permission.announcement.publish', 1804],
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

export function isPermissionKey(value: string): value is PermissionKey {
  return (ALL_PERMISSION_KEYS as string[]).includes(value);
}

// ── 權限依賴樹（docs/rbac/02-permission-catalog.md §9、docs/rbac/01-domain-model.md §9.2 D6）──

/**
 * 一個權限鍵帶來的其他鍵：
 * - `includes`（子能力）：同一個資源；上層的能力包含它，它也可以單獨授予（`user:update` ⇒ `user:resetPassword`）。
 * - `requires`（依賴）：少了它就無法完整操作；可以跨資源，但只能指向 read（`user:assignRole` ⇒ `role:read`）。
 * 兩者在解析時一視同仁：持有左邊 ⇒ 也持有右邊。
 */
export interface PermissionDependency {
  includes?: readonly PermissionKey[];
  requires?: readonly PermissionKey[];
}

/**
 * 依賴樹本身。規則 A：`create ⇒ 編輯自己建立的 ⇒ read`；沒有擁有者概念的資源退化成 `create ⇒ update`。
 * 「編輯自己建立的」不是權限鍵，是資源模型上的關係（file 的 `can_update_own`），所以 `file:create` 只帶 `file:read`。
 */
export const PERMISSION_DEPENDENCIES = {
  'user:create': { includes: ['user:update'] },
  'user:delete': { includes: ['user:update'] },
  'user:update': { includes: ['user:resetPassword', 'user:read'] },
  'user:resetPassword': { includes: ['user:read'] },
  'user:assignRole': { includes: ['user:read'], requires: ['role:read'] },

  'role:create': { includes: ['role:update'] },
  'role:delete': { includes: ['role:update'] },
  'role:update': { includes: ['role:read'] },
  'role:grantPermission': { includes: ['role:read'], requires: ['permission:read'] },

  'system:update': { includes: ['system:read'] },
  'approval:review': { includes: ['approval:read'] },

  'file:create': { includes: ['file:read'] },
  'file:delete': { includes: ['file:update'] },
  'file:update': { includes: ['file:read'] },
  'file:share': { includes: ['file:read'] },
  'file:read': { includes: ['file:access'] },
  'file:listPersonal': { includes: ['file:access'] },

  'job:retry': { includes: ['job:read'] },

  'identityProvider:create': { includes: ['identityProvider:update'] },
  'identityProvider:delete': { includes: ['identityProvider:update'] },
  'identityProvider:update': { includes: ['identityProvider:read'] },

  'group:create': { includes: ['group:update'] },
  'group:delete': { includes: ['group:update'] },
  // 挑成員要看得到使用者
  'group:update': { includes: ['group:read'], requires: ['user:read'] },
  'group:assignRole': { includes: ['group:read'], requires: ['role:read'] },

  // 路徑會經過使用者、群組、角色
  'authz:explain': { requires: ['user:read', 'role:read', 'group:read'] },

  'serviceAccount:create': { includes: ['serviceAccount:update'] },
  'serviceAccount:delete': { includes: ['serviceAccount:update'] },
  // 指派角色要看得到角色；角色與 token 的反提權在操作本身檢查
  'serviceAccount:update': { includes: ['serviceAccount:read'], requires: ['role:read'] },

  'webhook:create': { includes: ['webhook:update'] },
  'webhook:delete': { includes: ['webhook:update'] },
  'webhook:update': { includes: ['webhook:read'] },

  // 沒有 tag:read：定義對進得了該標籤組的人都可讀
  'tag:create': { includes: ['tag:update'] },
  'tag:delete': { includes: ['tag:update'] },

  // 每一列都帶收件人
  'notification:read': { requires: ['user:read'] },

  'announcement:create': { includes: ['announcement:update'] },
  'announcement:delete': { includes: ['announcement:update'] },
  // 受眾選擇器要看得到使用者、群組、角色
  'announcement:update': {
    includes: ['announcement:read'],
    requires: ['user:read', 'group:read', 'role:read'],
  },
  'announcement:publish': { includes: ['announcement:update'] },
} as const satisfies Partial<Record<PermissionKey, PermissionDependency>>;

export type PermissionDependencyMap = Partial<Record<PermissionKey, PermissionDependency>>;

/**
 * 受反提權限制的鍵：不能被任何鍵包含（不變條件 G4），只能是根。
 * 否則「能編輯使用者」就會悄悄等於「能指派角色」，繞過反提權的檢查點。
 */
export const ESCALATION_GUARDED_PERMISSIONS = [
  'user:assignRole',
  'role:grantPermission',
  'file:share',
  'group:assignRole',
] as const satisfies readonly PermissionKey[];

/** 依賴只能指向 read；`file:access` 是檔案管理器的閘門，也只帶來「能進入」。 */
function isReadLike(key: string): boolean {
  return key.endsWith(':read') || key === 'file:access';
}

function resourceOf(key: string): string {
  return key.slice(0, key.indexOf(':'));
}

/** 直接帶來的鍵（子能力 ∪ 依賴）。 */
export function directlyImplied(
  key: PermissionKey,
  dependencies: PermissionDependencyMap = PERMISSION_DEPENDENCIES,
): readonly PermissionKey[] {
  const entry = dependencies[key];
  return entry ? [...(entry.includes ?? []), ...(entry.requires ?? [])] : [];
}

/** 閉包：這些鍵加上它們（遞迴）帶來的所有鍵。 */
export function permissionClosure(
  keys: Iterable<PermissionKey>,
  dependencies: PermissionDependencyMap = PERMISSION_DEPENDENCIES,
): Set<PermissionKey> {
  const result = new Set<PermissionKey>();
  const stack = [...keys];
  while (stack.length > 0) {
    const key = stack.pop() as PermissionKey;
    if (result.has(key)) continue;
    result.add(key);
    stack.push(...directlyImplied(key, dependencies));
  }
  return result;
}

/**
 * `explicit` 之中（遞迴）帶來 `key` 的鍵，不含 `key` 自己；依 `explicit` 的順序。
 * 角色權限編輯器顯示「已包含（由 …）」用。
 */
export function implyingPermissions(
  key: PermissionKey,
  explicit: Iterable<PermissionKey>,
  dependencies: PermissionDependencyMap = PERMISSION_DEPENDENCIES,
): PermissionKey[] {
  return [...explicit].filter(
    (candidate) =>
      candidate !== key &&
      permissionClosure(directlyImplied(candidate, dependencies), dependencies).has(key),
  );
}

/**
 * 依賴樹的不變條件 G1–G4（docs/rbac/02-permission-catalog.md §9.2）；回傳違反的說明，空陣列表示通過。
 * `keys` 是目錄裡的所有鍵：指到目錄外的鍵也算違反。
 */
export function validatePermissionDependencies(
  dependencies: PermissionDependencyMap = PERMISSION_DEPENDENCIES,
  keys: readonly string[] = ALL_PERMISSION_KEYS,
  guarded: readonly string[] = ESCALATION_GUARDED_PERMISSIONS,
): string[] {
  const errors: string[] = [];
  const known = new Set(keys);
  const guardedSet = new Set(guarded);
  for (const [key, entry] of Object.entries(dependencies) as [
    PermissionKey,
    PermissionDependency,
  ][]) {
    if (!known.has(key)) errors.push(`${key} 不在權限目錄裡`);
    for (const target of entry.includes ?? []) {
      if (!known.has(target)) errors.push(`${key} 的子能力 ${target} 不在權限目錄裡`);
      if (resourceOf(target) !== resourceOf(key)) {
        errors.push(`G2：${key} 的子能力 ${target} 不是同一個資源（跨資源要寫成依賴）`);
      }
    }
    for (const target of entry.requires ?? []) {
      if (!known.has(target)) errors.push(`${key} 的依賴 ${target} 不在權限目錄裡`);
      if (!isReadLike(target)) errors.push(`G3：${key} 的依賴 ${target} 不是 read`);
    }
    for (const target of [...(entry.includes ?? []), ...(entry.requires ?? [])]) {
      if (guardedSet.has(target)) {
        errors.push(`G4：${target} 受反提權限制，不能被 ${key} 包含`);
      }
    }
  }

  // G1：沿著邊走回自己就是循環
  for (const key of Object.keys(dependencies) as PermissionKey[]) {
    if (permissionClosure(directlyImplied(key, dependencies), dependencies).has(key)) {
      errors.push(`G1：${key} 的依賴形成循環`);
    }
  }
  return errors;
}

/** 啟動時呼叫：依賴樹違反不變條件就讓程序啟動失敗（與路由稽核同一個層級）。 */
export function assertPermissionDependencies(): void {
  const errors = validatePermissionDependencies();
  if (errors.length) {
    throw new Error(
      '權限依賴樹違反不變條件（db/seeds/permissions.ts 的 PERMISSION_DEPENDENCIES）：\n' +
        errors.map((error) => `  - ${error}`).join('\n'),
    );
  }
}
