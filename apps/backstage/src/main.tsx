import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import 'virtual:uno.css';
import './index.css';

import { fetchRefreshMutation } from '@/apis/auth/refresh/fetcher';
import { applyResourceChanges } from '@/apis/resources';
import { App } from '@/app/App';
import { featureActivationPlugin } from '@/app/features';
import { appContextPlugin } from '@/app/plugin';
import { createAppContext } from '@/core/app';
import { MAIN_BACKEND } from '@/core/client';
import { hydratePreferences } from '@/core/store';
import { accountFeaturePlugin } from '@/features/account';
import { approvalFeaturePlugin } from '@/features/approval';
import { authFeaturePlugin } from '@/features/auth';
import { homeFeaturePlugin } from '@/features/home';
import { identityProviderFeaturePlugin } from '@/features/identity-provider';
import { permissionFeaturePlugin } from '@/features/permission';
import { roleFeaturePlugin } from '@/features/role';
import { systemFeaturePlugin } from '@/features/system';
import { userFeaturePlugin } from '@/features/user';
import {
  batchQueuePlugin,
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

  // 直接比對 import.meta.env（不經 ENV 物件）：Vite 換成字面值後打包器才能把這段與 MSW 的 chunk（約 430 KB）
  // 整個拿掉；經過物件屬性時不會被常數折疊，正式產物會多帶一個用不到的 chunk
  if (import.meta.env.VITE_ENABLE_MOCK === 'true') {
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
    .use(featureFlagPlugin({}))
    // 全域批次佇列：SharedWorker 排程、分頁以一般 API 逐筆執行；session 結束時取消（要用 httpContext 建立的 session）
    .use(batchQueuePlugin({ backend: MAIN_BACKEND }));

  // 即時推播：必須在 httpContext 之後（要用它建立的 session）；依賴圖換算在這裡注入（plugin 不認識 apis/）。
  // Mock 模式不註冊：MSW 不處理 Socket.io，行為等同推播停用（docs/architecture/frontend/11-realtime.md §9）
  if (!ENV.ENABLE_MOCK) {
    context.use(realtimePlugin({ backend: MAIN_BACKEND, onResourceChanged: applyResourceChanges }));
  }

  context
    // 常駐 feature 的 plugin factory —— ★ 在此「同步」註冊頁面權限。
    // 可啟用的 feature（檔案、稽核紀錄、背景工作）不在這裡：登入後依租戶的啟用清單安裝（app/features.ts）
    .use(authFeaturePlugin())
    .use(homeFeaturePlugin())
    .use(userFeaturePlugin())
    .use(roleFeaturePlugin())
    .use(permissionFeaturePlugin())
    .use(approvalFeaturePlugin())
    .use(identityProviderFeaturePlugin())
    .use(systemFeaturePlugin())
    .use(accountFeaturePlugin())
    // 擴充 feature 的小外掛：往偏好頁插「表格欄位」分頁
    .use(tableColumnSettingsPlugin())
    // 可啟用 feature 的安裝器（登入後依租戶的啟用清單安裝，docs/adr/0021-runtime-feature-activation.md）
    .use(featureActivationPlugin())
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
