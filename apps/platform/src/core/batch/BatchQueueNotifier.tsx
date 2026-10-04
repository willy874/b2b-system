import { useState } from 'react';

import { useTranslation } from '@/core/locales';
import { useToast } from '@/core/notify';

import { useBatchJobFinished } from './activeQueue';
import { useBatchJobName } from './BatchJobProgress';
import { BatchResultDialog } from './BatchResultDialog';
import { getBatchOperation, loadBatchOperationLocales } from './operations';
import type { BatchJob } from './types';

/**
 * 批次工作結束時彈出結果（不論成功或失敗）。整個 app 掛一次（AppHeader 旁）：
 * 佇列只把結束通知送給一個分頁——發起的分頁，它關掉了才給其他分頁。
 *
 * | 結果 | 彈出 |
 * | ---- | ---- |
 * | 全部成功 | 成功 toast（操作的 `successKey`） |
 * | 有失敗 | 結果對話框逐筆列出失敗的項目與原因 |
 * | 取消 | 資訊 toast：已完成幾筆 |
 */
export function BatchQueueNotifier() {
  const { t } = useTranslation();
  const toast = useToast();
  const name = useBatchJobName();
  const [failedJob, setFailedJob] = useState<BatchJob>();

  const show = (job: BatchJob) => {
    if (job.failures.length > 0) {
      setFailedJob(job);
      return;
    }
    if (job.status === 'cancelled') {
      toast.info(
        t('common.batch.cancelledToast', { name: name(job), count: job.succeeded.length }),
      );
      return;
    }
    const operation = getBatchOperation(job.operation);
    toast.success(
      operation
        ? t(operation.successKey, { count: job.succeeded.length })
        : t('common.batch.doneToast', { name: name(job), count: job.succeeded.length }),
    );
  };

  // 發起的頁面可能已經換到別的 feature：先補載操作名稱的語系再彈出
  useBatchJobFinished((job) => {
    void loadBatchOperationLocales([job.operation]).then(() => show(job));
  });

  return <BatchResultDialog job={failedJob} onClose={() => setFailedJob(undefined)} />;
}
