/** IdP 登記的第一方 client → 顯示名稱的語系鍵（apps/api 的 `OIDC_CLIENT`）。 */
export const CLIENT_NAME_KEY: Partial<Record<string, string>> = {
  backstage: 'login.client.backstage',
  auth: 'login.client.auth',
};

/** provider 的協定錯誤（`/error?error=…`）→ 語系鍵；其餘一律顯示通用訊息。 */
export const SSO_ERROR_KEY: Partial<Record<string, string>> = {
  invalid_redirect_uri: 'login.error.invalidRedirectUri',
  invalid_client: 'login.error.invalidClient',
  invalid_request: 'login.error.invalidRequest',
  // 外部 IdP 的 callback 對不上任何登入中的互動（過期、重複使用）
  AUTH_SSO_EXTERNAL_FAILED: 'error.AUTH_SSO_EXTERNAL_FAILED',
};
