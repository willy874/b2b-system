import { redirectUriOf } from '@b2b-system/web-core/auth';

import { fetchCurrentTenantQuery } from '@/apis/tenant/get-current-tenant/fetcher';
import { redirectToSso, SSO_CLIENT } from '@/core/auth/sso';

export { SSO_CLIENT };

/**
 * 頂層跳轉到 IdP 登入，帶上這個網域的租戶代碼：apps/platform 依它顯示租戶名稱、在那個租戶的帳號裡驗證
 * （docs/architecture/05-tenancy.md §10.2 D7、D8）。
 */
export async function startSsoLogin(returnTo: string | undefined): Promise<void> {
  const tenant = await fetchCurrentTenantQuery({ params: undefined });
  await redirectToSso(returnTo, tenant.code);
}

/** 兌換時送出的 redirect URI：必須與授權時帶的完全相同。 */
export function redirectUriOfClient(): string {
  return redirectUriOf(SSO_CLIENT);
}
