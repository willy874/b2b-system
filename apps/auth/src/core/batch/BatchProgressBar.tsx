import { useTranslation } from '@/core/locales';

import { BatchJobProgress } from './BatchJobProgress';
import type { BatchJob } from './types';

import styles from './BatchQueue.module.css';

interface BatchProgressBarProps {
  jobs: readonly BatchJob[];
  onCancel: (jobId: string) => void;
}

/** 列表送出的批次工作進行中時，取代表格上方的操作列（`RichTable` 的 `batch`）。 */
export function BatchProgressBar({ jobs, onCancel }: BatchProgressBarProps) {
  const { t } = useTranslation();
  return (
    <output
      aria-label={t('common.batch.progressLabel')}
      className={styles.bar}
      data-testid="batch-progress-bar"
    >
      {jobs.map((job) => (
        <BatchJobProgress key={job.id} job={job} onCancel={() => onCancel(job.id)} />
      ))}
    </output>
  );
}
