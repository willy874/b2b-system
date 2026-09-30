import type { PermissionKey } from '@/common/types';
import type { Transaction } from '@/core/database';

import type { TrashResourceType } from './trash.constants';

/** 回收桶的一列：各類型共用的形狀，類型特有的欄位不放進來（前端以類型決定還原的操作）。 */
export interface TrashItem {
  id: string;
  /** 主要的名稱（使用者：顯示名稱）。 */
  name: string;
  /** 次要的辨識資訊（使用者：email）；沒有時為 null。 */
  description: string | null;
  deletedAt: Date;
  /** 刪除的人；系統刪除或那個人已被永久刪除時為 null。 */
  deletedBy: { id: string; name: string } | null;
}

export interface TrashListQuery {
  offset: number;
  limit: number;
  keyword?: string;
}

/** 到期、這一輪要永久刪除的一列。 */
export interface ExpiredTrashItem {
  id: string;
  /** 寫進 `<resource>.purge` 稽核的 `resourceName`。 */
  name: string;
  deletedAt: Date;
}

/**
 * 一種資源的回收桶，由擁有資源的模組實作並在 `onModuleInit` 以 `TrashService.registerHandler()` 註冊
 * （docs/adr/0025-entity-revisions.md D9，與審批的 handler 同一個模式）。`modules/trash` 不 import 業務模組：
 * 還原端點（`POST /<resource>/:id/restore`）也由擁有者自己提供。
 */
export interface TrashHandler {
  readonly type: TrashResourceType;
  /** 看這種類型的回收桶所需的權限（`<resource>:delete`，ADR-0025 D10）。 */
  readonly permission: PermissionKey;
  /**
   * 永久刪除的順序，小的先：檔案 → 資料夾 → 使用者 → 角色（ADR-0025 D11）。
   * 外鍵的 `RESTRICT`（`files.folder_id`、`file_folders.owner_id`）靠這個順序滿足。
   */
  readonly purgeOrder: number;
  /** 已刪除的列，`deleted_at` 新的在前。 */
  listDeleted(query: TrashListQuery): Promise<{ items: TrashItem[]; total: number }>;
  /**
   * `deleted_at < cutoff` 的列，依 `id` 排序、從 `afterId` 之後取最多 `limit` 筆（keyset：本輪略過的列不會被重複取到）。
   * 已知這一輪刪不掉的（例：還擁有資料夾的使用者）直接不回傳。
   */
  findExpired(cutoff: Date, afterId: string | null, limit: number): Promise<ExpiredTrashItem[]>;
  /**
   * 在呼叫端的交易（每一列一個 savepoint）內硬刪除一列與它的連帶資料。回傳 `false` 代表這一輪略過
   * （列已不在、已被還原）。外鍵違反由呼叫端當作略過處理。
   */
  purge(item: ExpiredTrashItem, tx: Transaction): Promise<boolean>;
  /** 一批提交之後的副作用：快取失效、權限變更、推播。 */
  afterPurge(ids: readonly string[]): Promise<void>;
}
