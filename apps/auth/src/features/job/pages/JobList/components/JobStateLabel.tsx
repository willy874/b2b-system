import { useTranslation } from '@/core/locales';
import { cn } from '@/shared/utils';

import type { JobRowVM } from '../adapter';

export function JobStateLabel({
  row,
}: {
  row: Pick<JobRowVM, 'state' | 'stateLabelKey' | 'stateDotClass'>;
}) {
  const { t } = useTranslation();
  return (
    <span
      className="inline-flex items-center gap-1.5 text-sm"
      data-testid="job-state"
      data-value={row.state}
    >
      <span className={cn('inline-block h-2 w-2 rounded-full', row.stateDotClass)} aria-hidden />
      {t(row.stateLabelKey)}
    </span>
  );
}
