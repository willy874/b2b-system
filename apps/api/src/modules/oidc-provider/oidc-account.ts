/**
 * IdP 帳號 id 的格式（docs/adr/0020-physical-tenant-isolation.md D6）：身分屬於哪個租戶（或平台）寫在 id 裡，
 * A 租戶的 user id 不會被當成 B 租戶的。session、授權碼、ID token 的 `sub` 都是這個字串。
 */
export type OidcAccount =
  | { realm: 'tenant'; tenantId: string; userId: string }
  | { realm: 'platform'; adminId: string };

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const TENANT_ACCOUNT = new RegExp(`^t:(${UUID}):(${UUID})$`, 'i');
const PLATFORM_ACCOUNT = new RegExp(`^p:(${UUID})$`, 'i');

export function tenantAccountId(tenantId: string, userId: string): string {
  return `t:${tenantId}:${userId}`;
}

export function platformAccountId(adminId: string): string {
  return `p:${adminId}`;
}

/** 格式不對（例：前綴之前的舊 session）一律視為不存在的帳號。 */
export function parseAccountId(accountId: string | undefined): OidcAccount | undefined {
  if (!accountId) return undefined;
  const tenant = TENANT_ACCOUNT.exec(accountId);
  if (tenant) return { realm: 'tenant', tenantId: tenant[1]!, userId: tenant[2]! };
  const platform = PLATFORM_ACCOUNT.exec(accountId);
  if (platform) return { realm: 'platform', adminId: platform[1]! };
  return undefined;
}
