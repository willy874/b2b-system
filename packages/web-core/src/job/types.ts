import type { ChipTone } from '@b2b-system/ui/Chip';

import type { JOB_STATE_LABEL_KEY, JobState } from './constants';

/** 一種工作（佇列）的即時筆數。由 app 的 adapter 從自己的 api-sdk 型別轉來。 */
export interface JobQueueVM {
  name: string;
  /** 已知工作的顯示名稱；沒有就顯示 `name` 本身 */
  labelKey: string | undefined;
  /** 範圍的語系鍵（apps/platform：每個租戶／平台）；沒有就不顯示 */
  scopeLabelKey?: string;
  cron: string | null;
  readyCount: number;
  deferredCount: number;
  activeCount: number;
  failedCount: number;
  completedCount: number;
}

export interface JobRowVM {
  id: string;
  name: string;
  labelKey: string | undefined;
  state: JobState;
  stateLabelKey: (typeof JOB_STATE_LABEL_KEY)[JobState];
  stateTone: ChipTone;
  /** 已重試次數 / 上限 */
  retryCount: number;
  retryLimit: number;
  createdAt: Date;
  /** 排定在未來才執行（延後入列、重試退避中） */
  scheduledAt: Date | null;
  completedAt: Date | null;
  /** 只有 `failed` 且持有重試的權限才能重試 */
  canRetry: boolean;
}

/** 展開列的明細（列表不帶工作資料與結果，展開時才向後端取）。 */
export interface JobDetailVM {
  /** 失敗時的錯誤訊息（`output.message`）；成功或沒有訊息時是 `null` */
  errorMessage: string | null;
  data: Record<string, unknown>;
  output: Record<string, unknown> | null;
}
