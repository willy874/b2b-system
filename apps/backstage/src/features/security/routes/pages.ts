import { localeScopeLoader } from '@b2b-system/web-core/locales';
import { RootRoute } from '@b2b-system/web-core/router';
import { createRoute, redirect } from '@tanstack/react-router';

import { SECURITY_LOCALE_SCOPE } from '../locale';

/**
 * 租戶的安全政策（docs/architecture/backend/21-mfa.md §6）：分頁式容器，MFA 是第一個分頁；之後的 IP 允許清單、
 * 閒置逾時（docs/features/tenant-security-policy.md）加自己的分頁。常駐的 feature：不能被平台關掉。
 */
export const SecurityRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: '/security',
  staticData: { titleKey: 'menu.security' },
  loader: localeScopeLoader(SECURITY_LOCALE_SCOPE),
  beforeLoad: ({ location }) => {
    if (location.pathname.replace(/\/$/, '') === '/security')
      throw redirect({ to: '/security/mfa' });
  },
});

export const SecurityMfaRoute = createRoute({
  getParentRoute: () => SecurityRoute,
  path: '/mfa',
  staticData: { titleKey: 'security.mfa.tab' },
});
