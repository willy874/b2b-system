import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import 'virtual:uno.css';
import './index.css';

import { fetchRefreshMutation } from '@/apis/auth/refresh/fetcher';
import { App } from '@/app/App';
import { appContextPlugin } from '@/app/plugin';
import { createAppContext } from '@/core/app';
import { sessionStore } from '@/core/auth';
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
} from '@/plugins/app';
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
    .use(httpContextPlugin())
    .use(featureFlagPlugin({}))
    // 每個 feature 的 plugin factory —— ★ 在此「同步」註冊頁面權限
    .use(authFeaturePlugin())
    .use(homeFeaturePlugin())
    .use(userFeaturePlugin())
    .use(roleFeaturePlugin())
    .use(permissionFeaturePlugin())
    .use(auditLogFeaturePlugin())
    .use(accountFeaturePlugin())
    // 最後：建立 router（此時所有 route 都已存在）
    .use(appContextPlugin());

  // SessionStore 的續期實作：core/auth 不認識 apis/
  sessionStore.setRefreshFn(async () => {
    const session = await fetchRefreshMutation();
    return { accessToken: session.accessToken, expiresIn: session.expiresIn };
  });

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
