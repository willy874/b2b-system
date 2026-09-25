import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import 'virtual:uno.css';
import './index.css';

import { fetchRefreshMutation } from '@/apis/auth/refresh/fetcher';
import { applyResourceChanges } from '@/apis/resources';
import { App } from '@/app/App';
import { appContextPlugin } from '@/app/plugin';
import { createAppContext } from '@/core/app';
import { MAIN_BACKEND } from '@/core/client';
import { hydratePreferences } from '@/core/store';
import { accountFeaturePlugin } from '@/features/account';
import { auditLogFeaturePlugin } from '@/features/audit-log';
import { authFeaturePlugin } from '@/features/auth';
import { homeFeaturePlugin } from '@/features/home';
import { permissionFeaturePlugin } from '@/features/permission';
import { roleFeaturePlugin } from '@/features/role';
import { userFeaturePlugin } from '@/features/user';
import {
  cachePlugin,
  eventBusPlugin,
  featureFlagPlugin,
  httpContextPlugin,
  i18nPlugin,
  realtimePlugin,
  themePlugin,
} from '@/plugins/app';
import { tableColumnSettingsPlugin } from '@/plugins/features';
import { ENV } from '@/shared/constants';

async function bootstrap(): Promise<void> {
  // 偏好在 render 前水合，避免「先閃英文再變中文」
  hydratePreferences();

  if (ENV.ENABLE_MOCK) {
    const { startMockWorker } = await import('@/mocks/browser');
    await startMockWorker();
  }

  const context = createAppContext()
    // 基礎設施，必須最先（順序有隱含相依：httpContext 需要 cache 已建立）
    .use(cachePlugin())
    .use(eventBusPlugin())
    .use(i18nPlugin())
    .use(themePlugin())
    // 每個後端一組獨立的 session 與管道；續期實作在這裡注入（plugin 不認識 apis/）
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
    .use(featureFlagPlugin({}));

  // 即時推播：必須在 httpContext 之後（要用它建立的 session）；依賴圖換算在這裡注入（plugin 不認識 apis/）。
  // Mock 模式不註冊：MSW 不處理 Socket.io，行為等同推播停用（docs/architecture/frontend/11-realtime.md §9）
  if (!ENV.ENABLE_MOCK) {
    context.use(realtimePlugin({ backend: MAIN_BACKEND, onResourceChanged: applyResourceChanges }));
  }

  context
    // 每個 feature 的 plugin factory —— ★ 在此「同步」註冊頁面權限
    .use(authFeaturePlugin())
    .use(homeFeaturePlugin())
    .use(userFeaturePlugin())
    .use(roleFeaturePlugin())
    .use(permissionFeaturePlugin())
    .use(auditLogFeaturePlugin())
    .use(accountFeaturePlugin())
    // 擴充 feature 的小外掛：往偏好頁插「表格欄位」分頁
    .use(tableColumnSettingsPlugin())
    // 最後：建立 router（此時所有 route 都已存在）
    .use(appContextPlugin());

  await context.load();

  const container = document.querySelector('#root');
  if (!container) throw new Error('#root not found');

  createRoot(container).render(
    <StrictMode>
      <App context={context} />
    </StrictMode>,
  );
}

void bootstrap();
