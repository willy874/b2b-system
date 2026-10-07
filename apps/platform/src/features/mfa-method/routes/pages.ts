import { localeScopeLoader } from '@b2b-system/web-core/locales';
import { RootRoute } from '@b2b-system/web-core/router';
import { createRoute } from '@tanstack/react-router';

import { MFA_METHOD_LOCALE_SCOPE } from '../locale';

/** MFA 方式的全平台開關（`mfaMethod:read`，docs/architecture/backend/21-mfa.md §5）。 */
export const MfaMethodListRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: '/mfa-method',
  staticData: { titleKey: 'menu.mfaMethod' },
  loader: localeScopeLoader(MFA_METHOD_LOCALE_SCOPE),
});
