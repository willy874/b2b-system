import { Button } from '@b2b-system/ui/Button';
import { Progress } from '@b2b-system/ui/Progress';
import { formatBytes } from '@b2b-system/web-shared/utils';
import { useMemo } from 'react';

import { useTranslation } from '../locales';
import { jobProgressAmount, processedCount } from './activeQueue';
import { getBatchOperation } from './operations';
import type { BatchJob, BatchJobStatus } from './types';

import styles from './BatchQueue.module.css';

/** 狀態文字（完整字面量的語系 key，docs/conventions/06-literal-strings.md §3.1）。 */
const STATUS_KEY = {
  queued: 'common.batch.progress.queued',
  running: 'common.batch.progress.running',
  done: 'common.batch.progress.done',
  cancelled: 'common.batch.progress.cancelled',
} as const satisfies Record<BatchJobStatus, string>;

/** 工作的名稱：操作的 `labelKey`；這個分頁沒有註冊該操作時退回操作 id。 */
export function useBatchJobName(): (job: BatchJob) => string {
  const { t } = useTranslation();
  return (job) => {
    const operation = getBatchOperation(job.operation);
    return operation ? t(operation.labelKey) : job.operation;
  };
}

interface BatchJobProgressProps {
  job: BatchJob;
  onCancel?: () => void;
  onDismiss?: () => void;
  onViewFailures?: () => void;
}

/** 一個批次工作的進度：名稱、進度條、已處理／總筆數、失敗筆數與操作鈕。 */
export function BatchJobProgress({
  job,
  onCancel,
  onDismiss,
  onViewFailures,
}: BatchJobProgressProps) {
  const { t } = useTranslation();
  const name = useBatchJobName()(job);
  const done = processedCount(job);
  const total = job.items.length;
  const failed = job.failures.length;
  const active = job.status === 'queued' || job.status === 'running';
  // 項目帶份量（上傳的位元組）時依份量計算，處理中的項目也依回報的進度推進。
  // 每個快照都是新的 job：同一個快照只算一次（父元件因別的原因重繪時不重算）
  const amount = useMemo(() => jobProgressAmount(job), [job]);
  const percent = amount.total > 0 ? Math.round((amount.done / amount.total) * 100) : 0;

  return (
    <div
      className={styles.job}
      data-testid="batch-progress"
      data-value={job.id}
      data-status={job.status}
    >
      <Progress
        // Base UI 的百分比顯示直接格式化 value（不除以 max）：以 0–100 傳入
        value={Math.min(100, percent)}
        label={name}
        showValue
        tone={failed > 0 ? 'danger' : job.status === 'done' ? 'success' : 'brand'}
      />
      <div className={styles.meta}>
        <span data-testid="batch-progress-count" data-value={done}>
          {t(STATUS_KEY[job.status], { done, total })}
        </span>
        {amount.weighted && active && (
          <span data-testid="batch-progress-bytes">
            {formatBytes(amount.done)} / {formatBytes(amount.total)}
          </span>
        )}
        {active && job.pausedUntil !== undefined && (
          // 被限流而暫停（docs/architecture/frontend/07-ui-system.md §13.4）：進度條停住時說明原因
          <span data-testid="batch-progress-paused">{t('common.batch.progress.paused')}</span>
        )}
        {failed > 0 && (
          <span className={styles.failed} data-testid="batch-progress-failed" data-value={failed}>
            {t('common.batch.progress.failed', { count: failed })}
          </span>
        )}
        <span className={styles.metaActions}>
          {failed > 0 && !active && onViewFailures && (
            <Button
              size="sm"
              variant="ghost"
              onClick={onViewFailures}
              data-testid="batch-progress-failures"
            >
              {t('common.batch.viewFailures')}
            </Button>
          )}
          {active && onCancel && (
            <Button
              size="sm"
              variant="ghost"
              onClick={onCancel}
              data-testid="batch-progress-cancel"
            >
              {t('common.cancel')}
            </Button>
          )}
          {!active && onDismiss && (
            <Button
              size="sm"
              variant="ghost"
              onClick={onDismiss}
              data-testid="batch-progress-dismiss"
            >
              {t('common.batch.dismiss')}
            </Button>
          )}
        </span>
      </div>
    </div>
  );
}
