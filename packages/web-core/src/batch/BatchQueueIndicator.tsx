import { Button, IconButton } from '@b2b-system/ui/Button';
import { Icon } from '@b2b-system/ui/Icon';
import { Popover } from '@b2b-system/ui/Popover';
import { useState } from 'react';

import { useTranslation } from '../locales';
import {
  isBatchJobActive,
  useBatchJobs,
  useBatchOperationLocales,
  useBatchQueue,
} from './activeQueue';
import { BatchJobProgress } from './BatchJobProgress';
import { BatchResultDialog } from './BatchResultDialog';
import type { BatchJob } from './types';

import styles from './BatchQueue.module.css';

/**
 * AppHeader 上的佇列按鈕：徽章顯示進行中的工作數，點開列出所有分頁送出的批次工作與進度，
 * 可以取消進行中的、查看失敗項目、移除已結束的。
 */
export function BatchQueueIndicator() {
  const { t } = useTranslation();
  const queue = useBatchQueue();
  const jobs = useBatchJobs();
  const [failuresOf, setFailuresOf] = useState<BatchJob>();
  useBatchOperationLocales(jobs);
  if (!queue) return null;

  const activeCount = jobs.filter(isBatchJobActive).length;
  const newestFirst = jobs.toReversed();
  const hasFinished = jobs.some((job) => !isBatchJobActive(job));

  return (
    <>
      <Popover
        align="end"
        title={t('common.batch.queue.title')}
        className={styles.popup}
        data-testid="batch-queue-panel"
        trigger={
          <IconButton
            aria-label={
              activeCount > 0
                ? t('common.batch.queue.triggerActive', { count: activeCount })
                : t('common.batch.queue.trigger')
            }
            className={styles.trigger}
            data-active={activeCount > 0 || undefined}
            data-testid="batch-queue-trigger"
          >
            <Icon name="upload" size={16} />
            {/* 數量已含在 aria-label，徽章只給視覺 */}
            {activeCount > 0 && (
              <span aria-hidden className={styles.count} data-testid="batch-queue-count">
                {activeCount}
              </span>
            )}
          </IconButton>
        }
      >
        {newestFirst.length === 0 ? (
          <p className={styles.empty}>{t('common.batch.queue.empty')}</p>
        ) : (
          <ul className={styles.list}>
            {newestFirst.map((job) => (
              <li key={job.id} className={styles.listItem}>
                <BatchJobProgress
                  job={job}
                  onCancel={() => queue.cancel(job.id)}
                  onDismiss={() => queue.dismiss(job.id)}
                  onViewFailures={() => setFailuresOf(job)}
                />
              </li>
            ))}
          </ul>
        )}
        {hasFinished && (
          <div className={styles.panelFooter}>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => queue.clearFinished()}
              data-testid="batch-queue-clear"
            >
              {t('common.batch.queue.clearFinished')}
            </Button>
          </div>
        )}
      </Popover>
      <BatchResultDialog job={failuresOf} onClose={() => setFailuresOf(undefined)} />
    </>
  );
}
