import type { FilterBarProps } from '@/core/components';
import { useTranslation } from '@/core/locales';

import { JOB_STATE_LABEL_KEY, JOB_STATES } from '../../constants';
import type { JobSearchQuery } from '../../routes';
import type { JobQueueVM } from './adapter';
import type { useJobSearchFilter } from './useJobSearchFilter';

export type JobFilterValues = Pick<JobSearchQuery, 'name' | 'state'>;

const EMPTY_FILTERS: JobFilterValues = { name: undefined, state: undefined };

/** 篩選面板：工作種類（選項來自佇列清單）、狀態。 */
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
        type: 'select',
        key: 'name',
        label: t('job.field.name'),
        allLabel: t('job.filter.allNames'),
        options: queues.map((queue) => ({
          value: queue.name,
          label: queue.labelKey ? t(queue.labelKey) : queue.name,
        })),
      },
      {
        type: 'select',
        key: 'state',
        label: t('job.field.state'),
        allLabel: t('job.filter.allStates'),
        options: JOB_STATES.map((state) => ({
          value: state,
          label: t(JOB_STATE_LABEL_KEY[state]),
        })),
      },
    ],
  };
}
