import { createAuthorizationUrl, redirectUriOf } from '@/core/auth';
import type { SsoClientConfig } from '@/core/auth';
import { ENV } from '@/shared/constants';

/** backstage 在 IdP 登記的第一方 client（apps/api 的 `OIDC_CLIENT.BACKSTAGE`）。 */
export const SSO_CLIENT: SsoClientConfig = {
  issuer: ENV.OIDC_ISSUER,
  clientId: 'backstage',
  callbackPath: '/auth/callback',
};

/** 頂層跳轉到 IdP 登入（docs/adr/0019-sso-identity-platform.md D6）。 */
export async function startSsoLogin(returnTo: string | undefined): Promise<void> {
  globalThis.location.assign(await createAuthorizationUrl(SSO_CLIENT, returnTo));
}

/** 兌換時送出的 redirect URI：必須與授權時帶的完全相同。 */
export function redirectUriOfClient(): string {
  return redirectUriOf(SSO_CLIENT);
}
