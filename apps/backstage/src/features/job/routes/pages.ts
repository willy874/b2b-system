import { createRoute, stripSearchParams } from '@tanstack/react-router';

import { requireFeature } from '@/core/feature';
import { localeScopeLoader } from '@/core/locales';
import { RootRoute } from '@/core/router';

import { JOB_LOCALE_SCOPE } from '../locale';
import { DEFAULT_JOB_SEARCH, JobSearchQuerySchema } from './model';

/**
 * 這個 feature 在租戶啟用清單裡的 id（後端 `TENANT_FEATURES`）。可啟用的 feature 由平台管理者對每個租戶開關，
 * 登入後才安裝（docs/adr/0021-runtime-feature-activation.md）。
 */
export const JOB_FEATURE = 'job';

export const JobListRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: '/job',
  // 未啟用 → 404；清單還沒到或安裝中 → 等待，語系包的 loader 要在安裝之後才跑（ADR-0021 D6）
  beforeLoad: requireFeature(JOB_FEATURE),
  loader: localeScopeLoader(JOB_LOCALE_SCOPE),
  validateSearch: JobSearchQuerySchema,
  search: { middlewares: [stripSearchParams(DEFAULT_JOB_SEARCH)] },
});
