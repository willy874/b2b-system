import { i18n, loadLocaleScope } from '@/core/locales';

import type { BatchOperation } from './types';

const operations = new Map<string, BatchOperation>();

/**
 * 註冊一種批次操作。在 feature plugin 的 **同步** 階段呼叫：
 * 佇列可能在任何分頁啟動時就把排隊中的項目交給它執行。
 */
export function registerBatchOperation(operation: BatchOperation): void {
  operations.set(operation.id, operation);
}

export function getBatchOperation(id: string): BatchOperation | undefined {
  return operations.get(id);
}

/** 載入這些操作名稱所在的語系 scope（已載入過的不會重複下載）。 */
export async function loadBatchOperationLocales(
  operationIds: Iterable<string>,
  language: string = i18n.language,
): Promise<void> {
  const scopes = new Set<string>();
  for (const id of operationIds) {
    const scope = operations.get(id)?.localeScope;
    if (scope) scopes.add(scope);
  }
  await Promise.all([...scopes].map((scope) => loadLocaleScope(scope, language)));
}

/** 測試用：清空註冊表。 */
export function resetBatchOperations(): void {
  operations.clear();
}
