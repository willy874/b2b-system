import type { PermissionKey } from './enums';

export const PermissionAction = {
  CREATE: 'create',
  READ: 'read',
  UPDATE: 'update',
  DELETE: 'delete',
} as const;
export type PermissionAction = (typeof PermissionAction)[keyof typeof PermissionAction];

export const PermissionResource = {
  USER: 'user',
  ROLE: 'role',
  PERMISSION: 'permission',
  AUDIT_LOG: 'auditLog',
  SYSTEM: 'system',
  APPROVAL: 'approval',
} as const;
export type PermissionResource = (typeof PermissionResource)[keyof typeof PermissionResource];

export const PermissionMatch = {
  EVERY: 'every',
  SOME: 'some',
} as const;
export type PermissionMatch = (typeof PermissionMatch)[keyof typeof PermissionMatch];

/**
 * `buildPermissionKey('auditLog', 'create')` 會產生一個後端從不核發的鍵——
 * 這是可以的：權限集合裡永遠不會有它，該能力恆為 false。
 */
export function buildPermissionKey(
  resource: PermissionResource,
  action: PermissionAction,
): PermissionKey {
  return `${resource}:${action}` as PermissionKey;
}

/** 品牌化字串：隨手寫的字串沒辦法混進需要 PageKey 的位置。 */
export type PageKey = string & { readonly __brand: 'PageKey' };

export function definePageKey(key: string): PageKey {
  return key as PageKey;
}

export interface PagePermissionRule {
  /** 這一頁治理的資源。有了它才能派生 canCreate/canRead/canUpdate/canDelete。 */
  resource?: PermissionResource;
  /** 進入這一頁所需的權限鍵。空陣列 = 任何已登入使用者都能進。 */
  access: PermissionKey[];
  match: PermissionMatch;
}

export function evaluateAccess(
  rule: PagePermissionRule,
  canEvery: (keys: readonly PermissionKey[]) => boolean,
  canSome: (keys: readonly PermissionKey[]) => boolean,
): boolean {
  if (rule.match === PermissionMatch.EVERY) return canEvery(rule.access);
  if (rule.match === PermissionMatch.SOME) return canSome(rule.access);
  // 未知策略大聲失敗，而不是靜默把頁面全開或全關
  throw new Error(`Unsupported permission match: ${String(rule.match)}`);
}
