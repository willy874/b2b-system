import type {
  AnyTransferResource,
  ImportMode,
  TransferColumn,
  TransferContext,
  TransferLocale,
} from './data-transfer.types';
import type { ImportColumnView } from './dto/data-transfer.dto';

/**
 * 欄位層級的權限與可見性（docs/architecture/backend/22-data-transfer.md §5.2、§9.1）：
 * 讀不到的欄位不出現在匯出、範本與預覽；能讀但不能匯入的欄位在匯入時標為「忽略」並註明原因。
 */

export type AnyColumn = TransferColumn<unknown>;

/** 操作者有權讀的欄位。 */
export function isReadable(column: AnyColumn, ctx: TransferContext): boolean {
  return !column.permission || ctx.can(column.permission);
}

/** 匯出可以選的欄位：有 `export`、有權讀。 */
export function exportableColumns(
  resource: AnyTransferResource,
  ctx: TransferContext,
): AnyColumn[] {
  return resource.columns.filter((column) => column.export && isReadable(column, ctx));
}

export interface ImportColumnSets {
  /** 這個模式可以匯入、操作者也有權限的欄位，依定義的順序。 */
  importable: AnyColumn[];
  /** 這個模式的欄位，但操作者沒有權讀或沒有匯入的權限。 */
  forbidden: AnyColumn[];
  /** 已知但唯讀的欄位（只有 `export`，或這個模式不能匯入）。 */
  readOnly: AnyColumn[];
}

export function importColumnSets(
  resource: AnyTransferResource,
  mode: ImportMode,
  ctx: TransferContext,
): ImportColumnSets {
  const sets: ImportColumnSets = { importable: [], forbidden: [], readOnly: [] };
  for (const column of resource.columns) {
    if (!column.import?.modes.includes(mode)) {
      if (column.export) sets.readOnly.push(column);
      continue;
    }
    const allowed =
      isReadable(column, ctx) && (!column.import.permission || ctx.can(column.import.permission));
    (allowed ? sets.importable : sets.forbidden).push(column);
  }
  return sets;
}

/** 修改模式：比對鍵（依 `matchKey` 排序）。 */
export function matchColumns(columns: readonly AnyColumn[]): AnyColumn[] {
  return columns
    .filter((column) => column.import?.matchKey !== undefined)
    .toSorted((a, b) => (a.import?.matchKey ?? 0) - (b.import?.matchKey ?? 0));
}

/** 修改模式：會被修改的欄位（比對鍵只用來找目標）。 */
export function isModifiable(column: AnyColumn, mode: ImportMode): boolean {
  return mode === 'create' || column.import?.matchKey === undefined;
}

export function toImportColumnView(
  resource: AnyTransferResource,
  column: AnyColumn,
  mode: ImportMode,
  locale: TransferLocale,
): ImportColumnView {
  const spec = column.import;
  return {
    key: column.key,
    label: column.label[locale],
    kind: column.kind,
    required: mode === 'create' && Boolean(spec?.requiredOnCreate),
    multiple: Boolean(column.multiple),
    matchKey: mode === 'update' ? (spec?.matchKey ?? null) : null,
    unique: Boolean(resource.importer?.uniqueColumns?.includes(column.key)),
    nullable: Boolean(spec?.nullable),
    suggest: Boolean(spec?.suggest),
    hint: column.hint?.[locale] ?? null,
    options:
      column.enum?.map((option) => ({ value: option.value, label: option.label[locale] })) ?? null,
    transitions: mode === 'update' && spec?.transitions ? mapRecord(spec.transitions) : null,
    sameFile: mode === 'create' ? (column.reference?.sameFile?.column ?? null) : null,
  };
}

function mapRecord(record: Readonly<Record<string, readonly string[]>>): Record<string, string[]> {
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, [...value]]));
}
