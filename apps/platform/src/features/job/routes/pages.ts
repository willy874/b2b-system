import { localeScopeLoader } from '@b2b-system/web-core/locales';
import { RootRoute } from '@b2b-system/web-core/router';
import { createRoute, stripSearchParams } from '@tanstack/react-router';

import { JOB_LOCALE_SCOPE } from '../locale';
import { DEFAULT_JOB_SEARCH, JobSearchQuerySchema } from './model';

/**
 * 平台管理者的背景工作監控（`platformJob:read`）：所有租戶與平台層級的工作。
 * feature 的入口 route 必須直掛 RootRoute 且用絕對路徑（routeBasePath 依賴這一點）。
 */
export const JobListRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: '/job',
  staticData: { titleKey: 'menu.job' },
  loader: localeScopeLoader(JOB_LOCALE_SCOPE),
  validateSearch: JobSearchQuerySchema,
  search: { middlewares: [stripSearchParams(DEFAULT_JOB_SEARCH)] },
});
