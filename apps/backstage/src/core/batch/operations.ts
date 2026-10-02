import { i18n, loadLocaleScope } from '@/core/locales';
import { createRegistry } from '@/shared/registry';

import type { BatchOperation } from './types';

/**
 * 批次操作的註冊表。可訂閱：feature 在執行期安裝或卸載時，分頁要向佇列更新自己能執行哪些操作
 * （docs/architecture/frontend/02-plugin-system.md §9.2 D10）。
 */
export const batchOperationRegistry = createRegistry<string, BatchOperation>('Batch operation');

/**
 * 註冊一種批次操作。在 feature plugin 的 **同步** 階段呼叫：
 * 佇列可能在任何分頁啟動時就把排隊中的項目交給它執行。回傳反註冊函式。
 */
export function registerBatchOperation(operation: BatchOperation): () => void {
  return batchOperationRegistry.register(operation.id, operation);
}

export function getBatchOperation(id: string): BatchOperation | undefined {
  return batchOperationRegistry.get(id);
}

/** 載入這些操作名稱所在的語系 scope（已載入過的不會重複下載）。 */
export async function loadBatchOperationLocales(
  operationIds: Iterable<string>,
  language: string = i18n.language,
): Promise<void> {
  const scopes = new Set<string>();
  for (const id of operationIds) {
    const scope = batchOperationRegistry.get(id)?.localeScope;
    if (scope) scopes.add(scope);
  }
  await Promise.all([...scopes].map((scope) => loadLocaleScope(scope, language)));
}

/** 測試用：清空註冊表。 */
export function resetBatchOperations(): void {
  batchOperationRegistry.reset();
}
