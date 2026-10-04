import { fetchCurrentTenantQuery } from '@/apis/tenant/get-current-tenant/fetcher';
import { createAuthorizationUrl, redirectUriOf } from '@/core/auth';
import type { SsoClientConfig } from '@/core/auth';
import { ENV } from '@/shared/constants';

/** backstage 在 IdP 登記的第一方 client（apps/api 的 `OIDC_CLIENT.BACKSTAGE`）。 */
export const SSO_CLIENT: SsoClientConfig = {
  issuer: ENV.OIDC_ISSUER,
  clientId: 'backstage',
  callbackPath: '/auth/callback',
};

/**
 * 頂層跳轉到 IdP 登入（docs/architecture/04-sso.md §12.2 D6），帶上這個網域的租戶代碼：
 * apps/platform 依它顯示租戶名稱、在那個租戶的帳號裡驗證（docs/architecture/05-tenancy.md §10.2 D7、D8）。
 */
export async function startSsoLogin(returnTo: string | undefined): Promise<void> {
  const tenant = await fetchCurrentTenantQuery({ params: undefined });
  globalThis.location.assign(
    await createAuthorizationUrl(SSO_CLIENT, returnTo, { tenant: tenant.code }),
  );
}

/** 兌換時送出的 redirect URI：必須與授權時帶的完全相同。 */
export function redirectUriOfClient(): string {
  return redirectUriOf(SSO_CLIENT);
}
