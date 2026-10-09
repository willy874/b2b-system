import { createAppContext } from '@b2b-system/web-core/app';
import { MAIN_BACKEND } from '@b2b-system/web-core/client';

import 'virtual:uno.css';
import './index.css';

import {
  batchQueuePlugin,
  cachePlugin,
  eventBusPlugin,
  httpContextPlugin,
  realtimePlugin,
  telemetryPlugin,
  themePlugin,
} from '@b2b-system/web-core/plugins/app';
import { hydratePreferences } from '@b2b-system/web-core/store';
import { tableColumnSettingsPlugin } from '@b2b-system/web-core/table-column-settings';
import { bindTelemetryRouter, telemetryRootOptions } from '@b2b-system/web-core/telemetry';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { fetchRefreshMutation } from '@/apis/auth/refresh/fetcher';
import { applyResourceChanges, invalidateResources } from '@/apis/resources';
import { App } from '@/app/App';
import { i18nPlugin } from '@/app/i18n';
import { appContextPlugin } from '@/app/plugin';
import { accountFeaturePlugin } from '@/features/account';
import { auditLogFeaturePlugin } from '@/features/audit-log';
import { cdnFeaturePlugin } from '@/features/cdn';
import { featureFlagFeaturePlugin } from '@/features/feature-flag';
import { homeFeaturePlugin } from '@/features/home';
import { jobFeaturePlugin } from '@/features/job';
import { loginFeaturePlugin } from '@/features/login';
import { mfaMethodFeaturePlugin } from '@/features/mfa-method';
import { notificationFeaturePlugin } from '@/features/notification';
import { platformAdminFeaturePlugin } from '@/features/platform-admin';
import { tenantFeaturePlugin } from '@/features/tenant';
import { ENV } from '@/shared/constants';

/**
 * apps/platform：全平台共用、不分工作區的身分與租戶入口（docs/architecture/04-sso.md §12.2 D1）。
 * plugin chain 與 apps/backstage 相同；沒有執行期啟用的 feature。
 */
async function bootstrap(): Promise<void> {
  // 偏好在 render 前水合，避免「先閃英文再變中文」
  hydratePreferences();

  const context = createAppContext()
    // 錯誤回報最先：啟動過程中的錯誤也收得到（docs/architecture/frontend/19-observability.md）
    .use(
      telemetryPlugin({
        app: 'platform',
        release: ENV.RELEASE,
        environment: ENV.MODE,
        enabled: ENV.APM_ENABLED,
        dsn: ENV.APM_DSN,
        projectId: ENV.APM_PROJECT_ID,
        publicKey: ENV.APM_PUBLIC_KEY,
        tracesSampleRate: ENV.APM_TRACES_SAMPLE_RATE,
      }),
    )
    // 基礎設施，必須最先（順序有隱含相依：httpContext 需要 cache 已建立）
    .use(cachePlugin())
    .use(eventBusPlugin())
    .use(i18nPlugin())
    .use(themePlugin())
    // session 只屬於 apps/platform 自己的 origin：refresh cookie 是 host-only（docs/architecture/04-sso.md §12.2 D6）
    .use(
      httpContextPlugin([
        {
          name: MAIN_BACKEND,
          baseUrl: ENV.API_BASE_URL,
          refresh: async () => {
            const session = await fetchRefreshMutation();
            return { accessToken: session.accessToken, expiresIn: session.expiresIn };
          },
        },
      ]),
    )
    // 全域批次佇列（同 backstage）：要用 httpContext 建立的 session；變更經這個 app 的依賴圖失效
    .use(batchQueuePlugin({ backend: MAIN_BACKEND, invalidate: invalidateResources }))
    // 平台管理者的即時推播（docs/architecture/backend/08-realtime.md §3.6）：要用 httpContext 建立的 session
    .use(realtimePlugin({ backend: MAIN_BACKEND, onResourceChanged: applyResourceChanges }))
    // 每個 feature 的 plugin factory —— ★ 在此「同步」註冊頁面權限
    .use(loginFeaturePlugin())
    .use(homeFeaturePlugin())
    .use(accountFeaturePlugin())
    .use(notificationFeaturePlugin())
    .use(tenantFeaturePlugin())
    .use(platformAdminFeaturePlugin())
    .use(auditLogFeaturePlugin())
    .use(featureFlagFeaturePlugin())
    .use(mfaMethodFeaturePlugin())
    .use(cdnFeaturePlugin())
    .use(jobFeaturePlugin())
    // 偏好頁的「表格欄位」分頁（web-core；列出各 feature 登記的表）
    .use(tableColumnSettingsPlugin())
    // 最後：建立 router（此時所有 route 都已存在）
    .use(appContextPlugin());

  await context.load();
  // 錯誤與 Web Vitals 以頁面的 path 樣板分組（不是帶 id 的網址）
  bindTelemetryRouter(context.router);

  const container = document.querySelector('#root');
  if (!container) throw new Error('#root not found');

  createRoot(container, telemetryRootOptions()).render(
    <StrictMode>
      <App context={context} />
    </StrictMode>,
  );
}

void bootstrap();
