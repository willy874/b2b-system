import { Injectable } from '@nestjs/common';

import { AppException } from '@/core/errors';
import { requireTenant } from '@/core/tenant';

import type { AnyTransferResource, ImportMode, TransferDirection } from './data-transfer.types';

const TYPE_PATTERN = /^[a-z][A-Za-z0-9]*$/;
const KEY_PATTERN = /^[a-z][A-Za-z0-9]*$/;

/**
 * 可匯入匯出的資源（docs/architecture/backend/22-data-transfer.md §5.1）：擁有者模組在 `onModuleInit` 登記，
 * 與審批 handler、標籤資源同一個做法。登記時檢查定義本身，寫錯就啟動失敗。
 */
@Injectable()
export class DataTransferRegistry {
  private readonly resources = new Map<string, AnyTransferResource>();

  register(resource: AnyTransferResource): void {
    if (!TYPE_PATTERN.test(resource.type)) {
      throw new Error(`匯入匯出的資源類型 ${resource.type} 要是 camelCase`);
    }
    if (this.resources.has(resource.type)) {
      throw new Error(`匯入匯出的資源類型 ${resource.type} 重複登記`);
    }
    assertColumns(resource);
    this.resources.set(resource.type, resource);
  }

  /** 目前租戶可用的資源（所屬 feature 已啟用）。 */
  list(): AnyTransferResource[] {
    const features = requireTenant().features;
    return [...this.resources.values()].filter(
      (resource) => !resource.feature || features.includes(resource.feature),
    );
  }

  /** 找不到，或不支援這個方向（或模式）時拋 `DATA_TRANSFER_TYPE_UNSUPPORTED`。 */
  require(type: string, direction?: TransferDirection, mode?: ImportMode): AnyTransferResource {
    const resource = this.resources.get(type);
    if (!resource) throw new AppException('DATA_TRANSFER_TYPE_UNSUPPORTED', { type });
    if (resource.feature && !requireTenant().features.includes(resource.feature)) {
      throw new AppException('FEATURE_DISABLED', { feature: resource.feature });
    }
    if (direction === 'export' && !resource.exporter) {
      throw new AppException('DATA_TRANSFER_TYPE_UNSUPPORTED', { type, direction });
    }
    if (direction === 'import') {
      const supported = mode ? resource.importer?.modes[mode] : resource.importer;
      if (!supported)
        throw new AppException('DATA_TRANSFER_TYPE_UNSUPPORTED', { type, direction, mode });
    }
    return resource;
  }

  find(type: string): AnyTransferResource | undefined {
    return this.resources.get(type);
  }
}

function assertColumns(resource: AnyTransferResource): void {
  const keys = new Set<string>();
  for (const column of resource.columns) {
    const where = `${resource.type}.${column.key}`;
    if (!KEY_PATTERN.test(column.key)) throw new Error(`欄位 ${where} 的 key 要是 camelCase`);
    if (keys.has(column.key)) throw new Error(`欄位 ${where} 重複`);
    keys.add(column.key);
    if (column.kind === 'enum' && !column.enum?.length) throw new Error(`欄位 ${where} 缺少 enum`);
    if (column.kind === 'reference' && !column.reference) {
      throw new Error(`欄位 ${where} 缺少 reference`);
    }
    if (column.kind === 'json' && column.import) throw new Error(`欄位 ${where}：json 不能匯入`);
    if (!column.export && !column.import) throw new Error(`欄位 ${where} 既不能匯出也不能匯入`);
    if (column.import?.matchKey !== undefined && !column.import.modes.includes('update')) {
      throw new Error(`欄位 ${where}：比對鍵只用在修改模式`);
    }
    // 修改模式的「目前值」以匯出的值表示
    if (column.import?.modes.includes('update') && !column.export) {
      throw new Error(`欄位 ${where}：修改模式的欄位要能匯出（比對目前值）`);
    }
  }
  const importer = resource.importer;
  if (!importer) return;
  if (importer.modes.create && !importer.create) {
    throw new Error(`資源 ${resource.type} 支援新增模式卻沒有 create()`);
  }
  if (importer.modes.update) {
    if (!importer.update || !importer.resolveTargets) {
      throw new Error(`資源 ${resource.type} 支援修改模式卻沒有 update()／resolveTargets()`);
    }
    if (!resource.columns.some((column) => column.import?.matchKey !== undefined)) {
      throw new Error(`資源 ${resource.type} 支援修改模式卻沒有比對鍵`);
    }
  }
  for (const key of importer.uniqueColumns ?? []) {
    if (!keys.has(key)) throw new Error(`資源 ${resource.type} 的唯一欄 ${key} 不存在`);
  }
  for (const column of resource.columns) {
    const sameFile = column.reference?.sameFile;
    if (!sameFile) continue;
    const where = `${resource.type}.${column.key}`;
    // 被引用的值要能唯一地指到一列，套用時才知道先建立哪一列
    if (!importer.uniqueColumns?.includes(sameFile.column)) {
      throw new Error(`欄位 ${where}：同檔引用的 ${sameFile.column} 要是唯一欄`);
    }
    if (column.multiple) throw new Error(`欄位 ${where}：同檔引用只能用在單一值的欄位`);
  }
}
