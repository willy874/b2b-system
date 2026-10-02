export const ENV = {
  API_BASE_URL: import.meta.env.VITE_API_BASE_URL ?? '/api',
  ENABLE_MOCK: import.meta.env.VITE_ENABLE_MOCK === 'true',
  MODE: import.meta.env.MODE,
  /** SSO 的 issuer：apps/auth origin 底下的 `/api/oidc`（docs/architecture/04-sso.md §12）。 */
  OIDC_ISSUER: import.meta.env.VITE_OIDC_ISSUER ?? 'http://localhost:5175/api/oidc',
  /** apps/auth 的網址：帳號流程與租戶管理在那裡。 */
  AUTH_APP_URL: import.meta.env.VITE_AUTH_APP_URL ?? 'http://localhost:5175',
} as const;
