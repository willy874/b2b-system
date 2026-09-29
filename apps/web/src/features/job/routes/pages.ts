import { createRoute, stripSearchParams } from '@tanstack/react-router';

import { localeScopeLoader } from '@/core/locales';
import { RootRoute } from '@/core/router';

import { JOB_LOCALE_SCOPE } from '../locale';
import { DEFAULT_JOB_SEARCH, JobSearchQuerySchema } from './model';

export const JobListRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: '/job',
  loader: localeScopeLoader(JOB_LOCALE_SCOPE),
  validateSearch: JobSearchQuerySchema,
  search: { middlewares: [stripSearchParams(DEFAULT_JOB_SEARCH)] },
});
