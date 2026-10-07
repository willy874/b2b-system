import { createAppContext } from '@b2b-system/web-core/app';
import { sessionStore } from '@b2b-system/web-core/auth';

import 'virtual:uno.css';
import './index.css';

import { MAIN_BACKEND } from '@b2b-system/web-core/client';
import { hydratePreferences } from '@b2b-system/web-core/store';
import { bindTelemetryRouter, telemetryRootOptions } from '@b2b-system/web-core/telemetry';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { fetchRefreshMutation } from '@/apis/auth/refresh/fetcher';
import { applyResourceChanges, invalidateResources } from '@/apis/resources';
import { App } from '@/app/App';
import { featureActivationPlugin } from '@/app/features';
import { appContextPlugin } from '@/app/plugin';
import { accountFeaturePlugin } from '@/features/account';
import { approvalFeaturePlugin } from '@/features/approval';
import { authFeaturePlugin } from '@/features/auth';
import { groupFeaturePlugin } from '@/features/group';
import { homeFeaturePlugin } from '@/features/home';
import { notificationFeaturePlugin } from '@/features/notification';
import { permissionFeaturePlugin } from '@/features/permission';
import { roleFeaturePlugin } from '@/features/role';
import { serviceAccountFeaturePlugin } from '@/features/service-account';
import { tagFeaturePlugin } from '@/features/tag';
import { userFeaturePlugin } from '@/features/user';
import {
  batchQueuePlugin,
  cachePlugin,
  eventBusPlugin,
  httpContextPlugin,
  i18nPlugin,
  realtimePlugin,
  telemetryPlugin,
  themePlugin,
} from '@/plugins/app';
import { tableColumnSettingsPlugin } from '@/plugins/features';
import { ENV } from '@/shared/constants';

async function bootstrap(): Promise<void> {
  // 偏好在 render 前水合，避免「先閃英文再變中文」
  hydratePreferences();

  // 直接比對 import.meta.env（不經 ENV 物件）：Vite 換成字面值後打包器才能把這段與 MSW 的 chunk（約 430 KB）
  // 整個拿掉；經過物件屬性時不會被常數折疊，正式產物會多帶一個用不到的 chunk
  if (import.meta.env.VITE_ENABLE_MOCK === 'true') {
    const { startMockWorker } = await import('@/mocks/browser');
    await startMockWorker();
    // 登入頁會直接跳去真的 SSO（apps/platform）：mock 模式一律視為已登入，由 MSW 回應續期與 profile。
    // 登出後停在登入頁；重新整理又會登入（docs/architecture/frontend/05-data-layer.md §10）
    sessionStore.presumeSession();
  }

  const context = createAppContext()
    // 錯誤回報最先：啟動過程中的錯誤也收得到（docs/architecture/frontend/19-observability.md）
    .use(
      telemetryPlugin({
        app: 'backstage',
        release: ENV.RELEASE,
        environment: ENV.MODE,
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
    // 全域批次佇列：SharedWorker 排程、分頁以一般 API 逐筆執行；session 結束時取消（要用 httpContext 建立的 session）。
    // 每一筆宣告的變更由佇列合併後經依賴圖失效（plugin 不認識 apis/）
    .use(batchQueuePlugin({ backend: MAIN_BACKEND, invalidate: invalidateResources }));

  // 即時推播：必須在 httpContext 之後（要用它建立的 session）；依賴圖換算在這裡注入（plugin 不認識 apis/）。
  // Mock 模式不註冊：MSW 不處理 Socket.io，行為等同推播停用（docs/architecture/frontend/11-realtime.md §9）
  if (!ENV.ENABLE_MOCK) {
    context.use(realtimePlugin({ backend: MAIN_BACKEND, onResourceChanged: applyResourceChanges }));
  }

  context
    // 常駐 feature 的 plugin factory —— ★ 在此「同步」註冊頁面權限。
    // 可啟用的 feature（檔案、稽核紀錄、背景工作、回收桶、系統設定、外部 IdP）不在這裡：
    // 登入後依租戶的啟用清單安裝（app/features.ts）
    .use(authFeaturePlugin())
    .use(homeFeaturePlugin())
    .use(userFeaturePlugin())
    .use(roleFeaturePlugin())
    .use(groupFeaturePlugin())
    .use(serviceAccountFeaturePlugin())
    .use(tagFeaturePlugin())
    .use(permissionFeaturePlugin())
    .use(approvalFeaturePlugin())
    .use(accountFeaturePlugin())
    .use(notificationFeaturePlugin())
    // 擴充 feature 的小外掛：往偏好頁插「表格欄位」分頁
    .use(tableColumnSettingsPlugin())
    // 可啟用 feature 的安裝器（登入後依租戶的啟用清單安裝，docs/architecture/frontend/02-plugin-system.md §9）
    .use(featureActivationPlugin())
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
