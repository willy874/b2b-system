import { Button } from '@b2b-system/ui/Button';
import { Chip } from '@b2b-system/ui/Chip';
import { Dialog } from '@b2b-system/ui/Dialog';
import { Icon } from '@b2b-system/ui/Icon';
import { useState } from 'react';

import { QueryError } from '../components';
import { useTranslation } from '../locales';
import { JobQueueSummary } from './JobQueueSummary';
import type { JobQueueVM } from './types';

export interface JobQueueDialogProps {
  queues: JobQueueVM[];
  /** 佇列摘要查詢失敗而且沒有舊資料時的錯誤：對話框裡說明並提供重試。 */
  error?: unknown;
  onRetry?: () => void;
  selectedNames: readonly string[];
  onSelect: (names: string[]) => void;
}

/**
 * 工作種類的卡片收在對話框裡（兩個 app 共用），列表上方只留一顆按鈕，失敗數掛在按鈕上。
 * 卡片點了直接套用到列表的篩選，對話框維持開著，可以連續選好幾種。
 */
export function JobQueueDialog({
  queues,
  error,
  onRetry,
  selectedNames,
  onSelect,
}: JobQueueDialogProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const failed = queues.reduce((sum, queue) => sum + queue.failedCount, 0);

  return (
    <>
      <Button onClick={() => setOpen(true)} data-testid="job-queue-open">
        <Icon name="grid" size={16} />
        {t('job.queues.open')}
        {failed > 0 && (
          <Chip tone="danger" data-testid="job-queue-open-failed" data-value={failed}>
            {t('job.queues.failed', { count: failed })}
          </Chip>
        )}
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        size="xl"
        title={t('job.queues.title')}
        description={t('job.queues.hint')}
        footer={<Button onClick={() => setOpen(false)}>{t('common.close')}</Button>}
        data-testid="job-queue-dialog"
      >
        {error && queues.length === 0 ? (
          <QueryError error={error} onRetry={onRetry} data-testid="job-queue-error" />
        ) : (
          <JobQueueSummary queues={queues} selectedNames={selectedNames} onSelect={onSelect} />
        )}
      </Dialog>
    </>
  );
}
