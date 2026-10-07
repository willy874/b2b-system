import type { FilterBarProps } from '@b2b-system/web-core/components';
import { JOB_STATE_LABEL_KEY, JOB_STATES } from '@b2b-system/web-core/job';
import type { JobQueueVM } from '@b2b-system/web-core/job';
import { useTranslation } from '@b2b-system/web-core/locales';

import type { JobSearchQuery } from '../../routes';
import type { useJobSearchFilter } from './useJobSearchFilter';

export type JobFilterValues = Pick<JobSearchQuery, 'name' | 'state'>;

const EMPTY_FILTERS: JobFilterValues = { name: undefined, state: undefined };

/** 篩選面板：工作種類（選項來自佇列清單）、狀態，兩者都可以多選。 */
export function useJobFilters(
  { search, setFilter }: ReturnType<typeof useJobSearchFilter>,
  queues: JobQueueVM[],
): FilterBarProps<JobFilterValues> {
  const { t } = useTranslation();
  return {
    value: { name: search.name, state: search.state },
    defaultValue: EMPTY_FILTERS,
    onSubmit: setFilter,
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
    ],
  };
}
