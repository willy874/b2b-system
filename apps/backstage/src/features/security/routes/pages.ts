import { localeScopeLoader } from '@b2b-system/web-core/locales';
import { RootRoute } from '@b2b-system/web-core/router';
import { createRoute } from '@tanstack/react-router';

import { SECURITY_LOCALE_SCOPE } from '../locale';

/**
 * 租戶的安全政策：系統設定的「安全性」分頁（docs/architecture/backend/21-mfa.md §6、docs/architecture/frontend/02-plugin-system.md §4.5）。
 * * 目前只有 MFA 政策；之後的 IP 允許清單、閒置逾時等安全政策放在同一頁的區塊。
 * 常駐的 feature：不能被平台關掉。
 */
export const SecurityMfaRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: '/system/security',
  staticData: { titleKey: 'menu.security' },
  loader: localeScopeLoader(SECURITY_LOCALE_SCOPE),
});
