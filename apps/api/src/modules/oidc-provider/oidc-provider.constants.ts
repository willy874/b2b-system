/** 第一方 client 的 id（docs/architecture/04-sso.md §12.2 D7）。 */
export const OIDC_CLIENT = {
  /** apps/backstage */
  BACKSTAGE: 'backstage',
  /** apps/platform 自己的頁面（租戶管理等）也經 SSO 登入 */
  AUTH: 'auth',
} as const;

export type OidcClientId = (typeof OIDC_CLIENT)[keyof typeof OIDC_CLIENT];

/** 產品的 callback 與登出後的頁面（各自 origin 底下的路徑）。 */
export const OIDC_CLIENT_PATHS = {
  [OIDC_CLIENT.BACKSTAGE]: { callback: '/auth/callback', loggedOut: '/auth/login' },
  [OIDC_CLIENT.AUTH]: { callback: '/callback', loggedOut: '/login' },
} as const satisfies Record<OidcClientId, { callback: string; loggedOut: string }>;

export const OIDC_SCOPES = ['openid', 'email', 'profile'] as const;

/** 各模型的存活時間（秒）。IdP session 與 app session 的 refresh token 同樣 7 天（docs/architecture/backend/04-auth.md §10）。 */
export const OIDC_TTL = {
  Session: 7 * 24 * 60 * 60,
  Interaction: 60 * 60,
  Grant: 14 * 24 * 60 * 60,
  // 授權碼只給 callback 立即兌換用
  AuthorizationCode: 60,
  IdToken: 60 * 60,
  AccessToken: 60 * 60,
} as const;
