export const ENV = {
  API_BASE_URL: import.meta.env.VITE_API_BASE_URL ?? '/api',
  ENABLE_MOCK: import.meta.env.VITE_ENABLE_MOCK === 'true',
  MODE: import.meta.env.MODE,
  /** SSO 的 issuer：apps/auth origin 底下的 `/api/oidc`（docs/adr/0019-sso-identity-platform.md）。 */
  OIDC_ISSUER: import.meta.env.VITE_OIDC_ISSUER ?? 'http://localhost:5175/api/oidc',
} as const;
