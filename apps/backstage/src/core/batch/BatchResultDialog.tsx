import { Button } from '@/components/Button';
import { Dialog } from '@/components/Dialog';
import { useErrorMessage } from '@/core/errors';
import { useTranslation } from '@/core/locales';

import { useBatchJobName } from './BatchJobProgress';
import { toBatchErrorInstance } from './errors';
import type { BatchJob } from './types';

interface BatchResultDialogProps {
  job: BatchJob | undefined;
  onClose: () => void;
}

/** 批次工作有失敗的項目時，逐筆列出名稱與原因。 */
export function BatchResultDialog({ job, onClose }: BatchResultDialogProps) {
  const { t } = useTranslation();
  const toMessage = useErrorMessage();
  const name = useBatchJobName();
  return (
    <Dialog
      open={Boolean(job)}
      onOpenChange={(open) => !open && onClose()}
      title={job ? t('common.batch.resultTitle', { name: name(job) }) : ''}
      description={t('common.batch.resultSummary', {
        succeeded: job?.succeeded.length ?? 0,
        failed: job?.failures.length ?? 0,
      })}
      footer={<Button onClick={onClose}>{t('common.close')}</Button>}
      data-testid="batch-result-dialog"
    >
      <ul className="m-0 flex max-h-80 flex-col gap-2 overflow-auto p-0">
        {job?.failures.map((failure) => (
          <li
            key={failure.id}
            className="flex list-none flex-col gap-0.5 text-sm"
            data-testid="batch-result-failure"
            data-value={failure.id}
          >
            <span className="font-medium">{failure.label}</span>
            <span className="text-[var(--color-fg-muted)]">
              {toMessage(toBatchErrorInstance(failure.error))}
            </span>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
