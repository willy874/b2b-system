import { createDraftStore } from '@b2b-system/web-shared/storage';
import type { DraftStore } from '@b2b-system/web-shared/storage';

import { DRAFT_KEEPING_END_REASONS } from './formDrafts';

/**
 * 匯入預覽的草稿（docs/architecture/backend/22-data-transfer.md §8.3）：與表單草稿同一套加密（AES-GCM、金鑰不落地），
 * 規則不同——每次修改後存（節流）、單筆上限 20 MiB、每個「身分 × 資源 × 模式」一份、24 小時過期。
 * 用自己的 IndexedDB，筆數淘汰不會擠掉表單草稿。內容的形狀由 `web-core/data-import` 決定。
 *
 * 放在這裡而不是 `data-import`：session 結束的清理在首屏的 `SessionWatcher`，不能把匯入頁的程式帶進首屏。
 */
const IMPORT_DRAFT_MAX_BYTES = 20 * 1024 * 1024;
const IMPORT_DRAFT_MAX_ENTRIES = 20;

let store: DraftStore | undefined;

export function importDraftStore(): DraftStore {
  store ??= createDraftStore({
    dbName: 'b2b-system:import-drafts',
    maxBytes: IMPORT_DRAFT_MAX_BYTES,
    maxEntries: IMPORT_DRAFT_MAX_ENTRIES,
  });
  return store;
}

/** 測試以只用記憶體的換掉。 */
export function setImportDraftStore(next: DraftStore | undefined): void {
  store = next;
}

/** session 結束：只在非自願、回來的仍是同一個人時保留（與表單草稿相同）；登出、撤銷等清掉那個人的草稿。 */
export function handleSessionEndForImportDrafts(
  reason: string,
  owner: string | undefined,
): Promise<void> {
  if (!owner || DRAFT_KEEPING_END_REASONS.has(reason)) return Promise.resolve();
  return importDraftStore().removeOwner(owner);
}

/** 登入成為某個人：其他人的草稿清掉。 */
export function handleSessionStartForImportDrafts(owner: string | undefined): Promise<void> {
  if (!owner) return Promise.resolve();
  return importDraftStore().keepOnlyOwner(owner);
}
