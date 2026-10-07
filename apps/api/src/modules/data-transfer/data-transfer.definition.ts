import type { TransferResource } from './data-transfer.types';

/**
 * 定義一個可匯入匯出的資源（docs/architecture/backend/22-data-transfer.md §5.1）：純函式，只用來讓 `columns` 的
 * `TRecord` 與 exporter／importer 的型別一致。擁有者模組把結果交給 `DataTransferRegistry.register()`。
 */
export function defineTransferResource<TFilter, TRecord>(
  resource: TransferResource<TFilter, TRecord>,
): TransferResource<TFilter, TRecord> {
  return resource;
}
