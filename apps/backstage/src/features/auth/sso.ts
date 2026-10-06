import { createAuthorizationUrl, redirectUriOf } from '@b2b-system/web-core/auth';
import type { SsoClientConfig } from '@b2b-system/web-core/auth';
import { useLocaleStore } from '@b2b-system/web-core/store';

import { fetchCurrentTenantQuery } from '@/apis/tenant/get-current-tenant/fetcher';
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
 * 另外帶目前的介面語系（OIDC 的 `ui_locales`）：兩個 app 在不同網域、localStorage 不共用，
 * 登入頁才會與 backstage 用同一個語言。
 */
export async function startSsoLogin(returnTo: string | undefined): Promise<void> {
  const tenant = await fetchCurrentTenantQuery({ params: undefined });
  globalThis.location.assign(
    await createAuthorizationUrl(SSO_CLIENT, returnTo, {
      tenant: tenant.code,
      ui_locales: useLocaleStore.getState().locale,
    }),
  );
}

/** 兌換時送出的 redirect URI：必須與授權時帶的完全相同。 */
export function redirectUriOfClient(): string {
  return redirectUriOf(SSO_CLIENT);
}
