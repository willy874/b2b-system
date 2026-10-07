import { defineJob } from '@/core/jobs';

export interface DataTransferJobData {
  transferId: string;
}

/**
 * 匯出（docs/architecture/backend/22-data-transfer.md §6.3）。工作資料只有傳輸 id：不放篩選條件、不放個資
 * （`job:read` 看得到工作資料）。每次重試從頭產生並覆寫同一個物件 key。
 */
export const DATA_TRANSFER_EXPORT_JOB = defineJob<DataTransferJobData>('dataTransfer.export', {
  scope: 'tenant',
  concurrency: 2,
  retryLimit: 2,
  retryDelaySeconds: 30,
  expireInSeconds: 60 * 60,
});

/**
 * 匯入的套用（§7.6）：每列一個交易、該列的結果與業務寫入同一個交易，重試只處理還是 `pending` 的列（恰好一次）。
 * 不用 `exclusive`：它以租戶為 singleton key，同一個租戶第三個排隊的套用會被丟掉。同一個傳輸只會有一個工作
 * （建立時入列一次，重試只在上一次失敗之後），而且開始時以條件式更新轉移狀態，不會被兩個 worker 同時處理。
 */
export const DATA_TRANSFER_APPLY_IMPORT_JOB = defineJob<DataTransferJobData>(
  'dataTransfer.applyImport',
  {
    scope: 'tenant',
    concurrency: 1,
    retryLimit: 5,
    retryDelaySeconds: 30,
    expireInSeconds: 60 * 60,
  },
);

/** 每天：到期的匯出檔與套用列、超過 90 天的傳輸紀錄（§10）。 */
export const DATA_TRANSFER_CLEANUP_JOB = defineJob<Record<string, never>>('dataTransfer.cleanup', {
  scope: 'tenant',
  exclusive: true,
  retryLimit: 3,
  retryDelaySeconds: 300,
  expireInSeconds: 30 * 60,
});
