import type { BatchResult } from '@/shared/api-sdk';

/** 選取的列依某個批次動作分成兩組。 */
export interface BatchTargets<TData> {
  /** 會送出的列。 */
  eligible: TData[];
  /** 不適用、不會送出的列（例如自己、系統角色）。 */
  skipped: TData[];
}

/** 確認框的內容；「N 筆會略過」由 `useBatchRunner` 自動補上。 */
export interface BatchConfirmContent {
  title: string;
  description: string;
  confirmLabel?: string;
}

/**
 * 列表頁宣告的一個批次動作（docs/architecture/frontend/07-ui-system.md §6.2）。
 * 資格判斷只是體驗：後端仍逐筆完整檢查（ADR-0009 D12）。
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
  /** 送出可執行的 id；失效快取交給 feature 的 mutation hook。 */
  run: (ids: string[]) => Promise<BatchResult>;
  /** 全部成功時的提示。 */
  successMessage: (count: number) => string;
}
