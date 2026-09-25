import { Button } from '@/components/Button';
import { Dialog } from '@/components/Dialog';
import { useTranslation } from '@/core/locales';

import type { BatchReport } from './useBatchRunner';

interface BatchResultDialogProps {
  report: BatchReport | undefined;
  onClose: () => void;
}

/** 批次動作有未完成的項目時，逐筆列出名稱與原因。 */
export function BatchResultDialog({ report, onClose }: BatchResultDialogProps) {
  const { t } = useTranslation();
  return (
    <Dialog
      open={Boolean(report)}
      onOpenChange={(open) => !open && onClose()}
      title={t('common.batch.resultTitle')}
      description={t('common.batch.resultSummary', {
        succeeded: report?.succeeded ?? 0,
        failed: report?.failures.length ?? 0,
      })}
      footer={<Button onClick={onClose}>{t('common.close')}</Button>}
      data-testid="batch-result-dialog"
    >
      <ul className="m-0 flex max-h-80 flex-col gap-2 overflow-auto p-0">
        {report?.failures.map((failure) => (
          <li
            key={failure.id}
            className="flex list-none flex-col gap-0.5 text-sm"
            data-testid="batch-result-failure"
            data-value={failure.id}
          >
            <span className="font-medium">{failure.label}</span>
            <span className="text-[var(--color-fg-muted)]">{failure.message}</span>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
