import { createAuthorizationUrl } from '@b2b-system/web-core/auth';
import type { SsoClientConfig } from '@b2b-system/web-core/auth';
import { useLocaleStore } from '@b2b-system/web-core/store';

import { ENV } from '@/shared/constants';

/** backstage 在 IdP 登記的第一方 client（apps/api 的 `OIDC_CLIENT.BACKSTAGE`）。 */
export const SSO_CLIENT: SsoClientConfig = {
  issuer: ENV.OIDC_ISSUER,
  clientId: 'backstage',
  callbackPath: '/auth/callback',
};

/**
 * 頂層跳轉到 IdP（docs/architecture/04-sso.md §12.2 D6），帶上這個網域的租戶代碼（呼叫端以 `apis/` 取得：`core/` 不碰 api）
 * 與目前的介面語系（OIDC 的 `ui_locales`：兩個 app 在不同網域、localStorage 不共用，登入頁才會與 backstage 用同一個語言）。
 * `extraParams`：例如「重新登入並新增通行金鑰」的 `prompt=login`、`mfa_enroll`（docs/architecture/backend/21-mfa.md §7.1）。
 */
export async function redirectToSso(
  returnTo: string | undefined,
  tenantCode: string,
  extraParams: Record<string, string> = {},
): Promise<void> {
  globalThis.location.assign(
    await createAuthorizationUrl(SSO_CLIENT, returnTo, {
      tenant: tenantCode,
      ui_locales: useLocaleStore.getState().locale,
      ...extraParams,
    }),
  );
}
