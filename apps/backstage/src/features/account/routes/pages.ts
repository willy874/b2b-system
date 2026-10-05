import { localeScopeLoader } from '@b2b-system/web-core/locales';
import { preferenceLocaleLoader } from '@b2b-system/web-core/preference';
import { RootRoute } from '@b2b-system/web-core/router';
import { createRoute } from '@tanstack/react-router';

import { ACCOUNT_LOCALE_SCOPE } from '../locale';

export const ProfileRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: '/profile',
  loader: localeScopeLoader(ACCOUNT_LOCALE_SCOPE),
});

export const PreferenceRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: '/preference',
  // 偏好頁也要顯示其他 feature 登記的分頁與列表名稱，一併載入它們的 scope
  loader: preferenceLocaleLoader(ACCOUNT_LOCALE_SCOPE),
});
