/**
 * 批次佇列的資料模型（docs/adr/0012-batch-queue-worker.md）。
 * 會在分頁、worker 之間以 structured clone 傳遞：只能放純資料（不可有函式、類別實例）。
 */

/** 一筆要處理的項目：`label` 是結果清單上顯示的名稱（例：email）。 */
export interface BatchJobItem {
  id: string;
  label: string;
}

/** 可序列化的錯誤：跨 worker 傳遞後由 `toBatchErrorInstance()` 還原，再交給 `useErrorMessage()`。 */
export type BatchItemError =
  | {
      kind: 'app';
      code: string;
      status: number;
      details?: Record<string, unknown>;
      requestId?: string;
    }
  | { kind: 'network' }
  | { kind: 'aborted'; reason: string }
  | { kind: 'unknown' };

export interface BatchItemFailure extends BatchJobItem {
  error: BatchItemError;
}

/**
 * - `queued`：排在前面的工作還沒做完
 * - `running`：正在逐筆處理
 * - `done`：全部處理過（成功與失敗都算處理過）
 * - `cancelled`：使用者取消；已處理的筆數保留，剩下的不再送出
 */
export type BatchJobStatus = 'queued' | 'running' | 'done' | 'cancelled';

export interface BatchJob {
  id: string;
  /** 已註冊的操作 id（`registerBatchOperation`），例：`user.delete`。 */
  operation: string;
  /** 發起的列表（`RichTable` 的 `batch.scope`）：該列表以進度條取代操作列。 */
  scope: string;
  /** 發起分頁的 `CLIENT_ID`：優先由它執行、結束時由它彈出結果。 */
  ownerId: string;
  items: BatchJobItem[];
  status: BatchJobStatus;
  succeeded: string[];
  failures: BatchItemFailure[];
  createdAt: number;
  finishedAt?: number;
}

/** 送進佇列時由呼叫端提供的部分；其餘由佇列補上。 */
export interface BatchJobInput {
  operation: string;
  scope: string;
  items: BatchJobItem[];
}

/**
 * 一種批次操作：每筆呼叫一次一般（單筆）API。由 feature 在 plugin 的同步階段註冊，
 * 所以每個分頁都認得所有操作——發起的分頁關掉後，其他分頁可以接手執行剩下的項目。
 */
export interface BatchOperation {
  /** 例：`user.delete`；在 `BatchAction.operation` 引用。 */
  id: string;
  /** 佇列面板、進度條上的名稱（完整字面量的語系 key）。 */
  labelKey: string;
  /** 全部成功時的提示，參數 `{ count }`。 */
  successKey: string;
  /**
   * 上面兩個 key 所在的語系 scope。佇列面板與結果提示在任何頁面都會顯示，
   * 不一定已經進過該 feature 的路由：顯示前由 `loadBatchOperationLocales()` 補載。
   */
  localeScope?: string;
  /** 處理一筆：打單筆 API ＋ 失效快取；失敗直接拋出（不在這裡提示）。 */
  run: (itemId: string) => Promise<unknown>;
}

// ── 列表頁的批次動作（RichTable 的 batch.actions） ──

/** 選取的列依某個批次動作分成兩組。 */
export interface BatchTargets<TData> {
  /** 會送出的列。 */
  eligible: TData[];
  /** 不適用、不會送出的列（例如自己、系統角色）。 */
  skipped: TData[];
}

/** 確認框的內容；「N 筆會略過」由 `RichTable` 自動補上。 */
export interface BatchConfirmContent {
  title: string;
  description: string;
  confirmLabel?: string;
}

/**
 * 列表頁宣告的一個批次動作（docs/architecture/frontend/07-ui-system.md §6.2）。
 * 資格判斷只是體驗：每筆仍由後端的單筆端點完整檢查。
 */
export interface BatchAction<TData> {
  /** 按鈕的 `data-value`（E2E 用）。 */
  id: string;
  label: string;
  /**
   * 按鈕的顏色（省略時為 secondary）。確認框的確認鈕：`danger` / `warning` 用危險色，其餘用 primary。
   */
  tone?: 'primary' | 'success' | 'warning' | 'danger';
  /**
   * 使用者永遠不會有這個權限時隱藏（docs/architecture/frontend/06-permission.md §6.1）；
   * 有權限但選到的列都不適用時則是停用＋說明，由 `isEligible` 決定。
   */
  hidden?: boolean;
  isEligible: (row: TData) => boolean;
  /** 選到的列都不適用時，停用按鈕的 tooltip 說明；省略時用通用文案。 */
  ineligibleReason?: string;
  confirm: (targets: BatchTargets<TData>) => BatchConfirmContent;
  /** 已註冊的操作 id：確認後把適用的列送進全域佇列，逐筆呼叫單筆 API。 */
  operation: string;
}
