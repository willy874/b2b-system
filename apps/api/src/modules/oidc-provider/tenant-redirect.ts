import type { TenantDirectory } from '@/core/tenant';

/**
 * backstage 的 redirect／登出後 URI 是否可以接受：path 相符、沒有 query／fragment／帳密、host 是某個租戶的網域
 * （docs/adr/0020-physical-tenant-isolation.md D7）。
 *
 * `strict`（production）時只接受 `https:`，網址帶 port 時必須與登記的網域（含 port）完全相符：否則授權碼可能
 * 經明文 http 送出，或被同一台主機上其他 port 的服務收走。
 * 開發與 E2E 的租戶網域常只登記 hostname（`localhost`），不 strict 時維持以 hostname 比對。
 */
export function isTenantRedirectAllowed(
  value: string,
  path: string,
  directory: Pick<TenantDirectory, 'tenantIdOfHost' | 'tenantIdOfExactHost'>,
  strict: boolean,
): boolean {
  const url = URL.canParse(value) ? new URL(value) : undefined;
  if (!url) return false;
  const protocols = strict ? ['https:'] : ['http:', 'https:'];
  if (!protocols.includes(url.protocol)) return false;
  if (url.pathname !== path || url.search || url.hash || url.username) return false;
  // `url.host` 已省略預設 port：沒寫 port 就是預設 port，只有寫了 port 才需要完全相符
  const tenantId =
    strict && url.port
      ? directory.tenantIdOfExactHost(url.host)
      : directory.tenantIdOfHost(url.host);
  return tenantId !== undefined;
}
