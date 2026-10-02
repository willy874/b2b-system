import { createAuthorizationUrl, redirectUriOf } from '@/core/auth';
import type { SsoClientConfig } from '@/core/auth';
import { ENV } from '@/shared/constants';

/** apps/auth 自己的頁面也是 IdP 的第一方 client（apps/api 的 `OIDC_CLIENT.AUTH`）。 */
export const SSO_CLIENT: SsoClientConfig = {
  issuer: ENV.OIDC_ISSUER,
  clientId: 'auth',
  callbackPath: '/callback',
};

/** 頂層跳轉到 IdP 登入（docs/architecture/04-sso.md §12.2 D6）。 */
export async function startSsoLogin(returnTo: string | undefined): Promise<void> {
  globalThis.location.assign(await createAuthorizationUrl(SSO_CLIENT, returnTo));
}

/** 兌換時送出的 redirect URI：必須與授權時帶的完全相同。 */
export function redirectUriOfClient(): string {
  return redirectUriOf(SSO_CLIENT);
}
