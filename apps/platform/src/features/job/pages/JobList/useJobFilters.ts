import type { FilterBarProps } from '@b2b-system/web-core/components';
import { JOB_STATE_LABEL_KEY, JOB_STATES } from '@b2b-system/web-core/job';
import type { JobQueueVM } from '@b2b-system/web-core/job';
import { useTranslation } from '@b2b-system/web-core/locales';

import { PLATFORM_TENANT_FILTER } from '../../constants';
import type { JobSearchQuery } from '../../routes';
import type { useJobSearchFilter } from './useJobSearchFilter';

/**
 * 網址上只有一個 `tenant`（租戶代碼，或保留值 `platform`）；面板拆成兩個欄位：
 * 「範圍」選「只看平台」，或在「租戶代碼」輸入代碼。兩者都填時「只看平台」優先。
 */
export type JobFilterValues = Pick<JobSearchQuery, 'name' | 'state'> & {
  scope?: typeof PLATFORM_TENANT_FILTER;
  tenant?: string;
};

const EMPTY_FILTERS: JobFilterValues = {
  name: undefined,
  state: undefined,
  scope: undefined,
  tenant: undefined,
};

/** 篩選面板：工作種類（選項來自佇列清單）、狀態（兩者都可以多選）、範圍（只看平台）、租戶代碼。 */
export function useJobFilters(
  { search, setFilter }: ReturnType<typeof useJobSearchFilter>,
  queues: JobQueueVM[],
): FilterBarProps<JobFilterValues> {
  const { t } = useTranslation();
  const isPlatformOnly = search.tenant === PLATFORM_TENANT_FILTER;
  return {
    value: {
      name: search.name,
      state: search.state,
      scope: isPlatformOnly ? PLATFORM_TENANT_FILTER : undefined,
      tenant: isPlatformOnly ? undefined : search.tenant,
    },
    defaultValue: EMPTY_FILTERS,
    onSubmit: ({ scope, tenant, ...rest }) =>
      setFilter({ ...rest, tenant: scope ?? (tenant?.toLowerCase() || undefined) }),
    fields: [
      {
        type: 'multiSelect',
        key: 'name',
        label: t('job.field.name'),
        options: queues.map((queue) => ({
          value: queue.name,
          label: queue.labelKey ? t(queue.labelKey) : queue.name,
        })),
      },
      {
        type: 'multiSelect',
        key: 'state',
        label: t('job.field.state'),
        options: JOB_STATES.map((state) => ({
          value: state,
          label: t(JOB_STATE_LABEL_KEY[state]),
        })),
      },
      {
        type: 'select',
        key: 'scope',
        label: t('job.filter.scope'),
        allLabel: t('job.filter.allScopes'),
        options: [{ value: PLATFORM_TENANT_FILTER, label: t('job.filter.platformOnly') }],
      },
      {
        type: 'text',
        key: 'tenant',
        label: t('job.filter.tenant'),
        placeholder: t('job.filter.tenantPlaceholder'),
      },
    ],
  };
}
