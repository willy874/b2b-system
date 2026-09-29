import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import 'virtual:uno.css';
import './index.css';

import { fetchRefreshMutation } from '@/apis/auth/refresh/fetcher';
import { App } from '@/app/App';
import { appContextPlugin } from '@/app/plugin';
import { createAppContext } from '@/core/app';
import { MAIN_BACKEND } from '@/core/client';
import { hydratePreferences } from '@/core/store';
import { homeFeaturePlugin } from '@/features/home';
import { identityProviderFeaturePlugin } from '@/features/identity-provider';
import { loginFeaturePlugin } from '@/features/login';
import {
  cachePlugin,
  eventBusPlugin,
  httpContextPlugin,
  i18nPlugin,
  themePlugin,
} from '@/plugins/app';
import { ENV } from '@/shared/constants';

/**
 * apps/auth：全平台共用、不分工作區的身分與租戶入口（docs/adr/0019-sso-identity-platform.md D1）。
 * plugin chain 與 apps/backstage 相同；這一版沒有推播、批次佇列與 feature flag。
 */
async function bootstrap(): Promise<void> {
  // 偏好在 render 前水合，避免「先閃英文再變中文」
  hydratePreferences();

  const context = createAppContext()
    // 基礎設施，必須最先（順序有隱含相依：httpContext 需要 cache 已建立）
    .use(cachePlugin())
    .use(eventBusPlugin())
    .use(i18nPlugin())
    .use(themePlugin())
    // session 只屬於 apps/auth 自己的 origin：refresh cookie 是 host-only（ADR-0019 D6）
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
    // 每個 feature 的 plugin factory —— ★ 在此「同步」註冊頁面權限
    .use(loginFeaturePlugin())
    .use(homeFeaturePlugin())
    .use(identityProviderFeaturePlugin())
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
