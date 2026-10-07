export const ENV = {
  API_BASE_URL: import.meta.env.VITE_API_BASE_URL ?? '/api',
  ENABLE_MOCK: import.meta.env.VITE_ENABLE_MOCK === 'true',
  MODE: import.meta.env.MODE,
  /** SSO 的 issuer：apps/platform origin 底下的 `/api/oidc`（docs/architecture/04-sso.md §12）。 */
  OIDC_ISSUER: import.meta.env.VITE_OIDC_ISSUER ?? 'http://localhost:5175/api/oidc',
  /** apps/platform 的網址：帳號流程與租戶管理在那裡。 */
  PLATFORM_APP_URL: import.meta.env.VITE_PLATFORM_APP_URL ?? 'http://localhost:5175',
  /** 建置時寫進產物的 release（commit）；本機是 `dev`。 */
  RELEASE: __APP_RELEASE__,
  /**
   * 前端錯誤回報（docs/architecture/frontend/19-observability.md §3）：都沒設時不送出、只 console.debug。
   * `APM_DSN` 是完整的 DSN（接真的 Sentry）；否則以專案 id 與 public key 在執行時組成同源的 DSN。
   */
  /** APM 整套的開關：`VITE_APM_ENABLED=false` 時不初始化錯誤回報（下面的值都不看）；沒設 = 開啟。 */
  APM_ENABLED: import.meta.env.VITE_APM_ENABLED !== 'false',
  APM_DSN: import.meta.env.VITE_APM_DSN as string | undefined,
  APM_PROJECT_ID: import.meta.env.VITE_APM_PROJECT_ID as string | undefined,
  APM_PUBLIC_KEY: import.meta.env.VITE_APM_PUBLIC_KEY as string | undefined,
  APM_TRACES_SAMPLE_RATE: Number(import.meta.env.VITE_APM_TRACES_SAMPLE_RATE ?? 0.1),
} as const;
