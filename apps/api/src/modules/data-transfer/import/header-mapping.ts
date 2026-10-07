import { AppException } from '@/core/errors';

import { isModifiable, matchColumns } from '../data-transfer.columns';
import type { AnyColumn, ImportColumnSets } from '../data-transfer.columns';
import { MULTI_VALUE_SEPARATOR } from '../data-transfer.constants';
import type { ImportMode } from '../data-transfer.types';
import { normalizeText } from '../data-transfer.values';

/**
 * 標頭對應（docs/architecture/backend/22-data-transfer.md §7.3、D5）：依序比對 `key`、任一語系的 `label`、`aliases`，
 * 比對前正規化（去空白、小寫、全形轉半形）——檔案的語言與介面語言無關。不認得的標頭不默默忽略：至少要在對應步驟按一次「忽略」。
 */

export type IgnoreReason = 'readOnly' | 'forbidden' | 'unmapped';

export interface HeaderSuggestion {
  index: number;
  text: string;
  /** 自動對應到的欄位 key；唯讀、沒有權限、不認得的是 null。 */
  suggestion: string | null;
  ignored?: 'readOnly' | 'forbidden';
}

export type MappingResult =
  | {
      complete: true;
      /** 每個來源欄對到的欄位 key（`null` = 忽略）。 */
      mapping: (string | null)[];
      /** 這次要匯入的欄位，依定義的順序。 */
      columns: AnyColumn[];
      ignored: { header: string; reason: IgnoreReason }[];
    }
  | { complete: false; headers: HeaderSuggestion[] };

function matches(column: AnyColumn, normalized: string): boolean {
  return [column.key, ...Object.values(column.label), ...(column.aliases ?? [])].some(
    (candidate) => normalizeText(candidate) === normalized,
  );
}

/** 解析請求帶的 `mapping`（`{ 來源欄序號: columnKey | null }` 的 JSON 字串）。 */
export function parseMappingParam(
  raw: string | undefined,
  headerCount: number,
  importable: readonly AnyColumn[],
): (string | null)[] | null {
  if (raw === undefined) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new AppException('DATA_TRANSFER_MAPPING_INVALID', { reason: 'json' });
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new AppException('DATA_TRANSFER_MAPPING_INVALID', { reason: 'shape' });
  }
  const mapping: (string | null)[] = Array.from({ length: headerCount }, () => null);
  const used = new Map<string, number>();
  for (const [indexText, key] of Object.entries(parsed)) {
    const index = Number(indexText);
    if (!Number.isInteger(index) || index < 0 || index >= headerCount) {
      throw new AppException('DATA_TRANSFER_MAPPING_INVALID', { index: indexText });
    }
    if (key === null) continue;
    const column =
      typeof key === 'string' ? importable.find((item) => item.key === key) : undefined;
    if (!column) throw new AppException('DATA_TRANSFER_MAPPING_INVALID', { column: String(key) });
    // 同一個欄位只能對一次；多值欄位例外（每欄一個值）
    if (used.has(column.key) && !column.multiple) {
      throw new AppException('DATA_TRANSFER_MAPPING_INVALID', {
        column: column.key,
        reason: 'duplicate',
      });
    }
    used.set(column.key, index);
    mapping[index] = column.key;
  }
  return mapping;
}

/** 對應完成的條件：新增模式所有必填欄都有對應；修改模式至少一個比對鍵加上至少一個可修改的欄位。 */
export function isMappingComplete(
  mode: ImportMode,
  columns: readonly AnyColumn[],
  all: readonly AnyColumn[],
): boolean {
  if (mode === 'create') {
    return all
      .filter((column) => column.import?.requiredOnCreate)
      .every((column) => columns.includes(column));
  }
  return (
    matchColumns(columns).length > 0 && columns.some((column) => isModifiable(column, 'update'))
  );
}

/**
 * @param knownReadOnly 其他已知的唯讀標頭（正規化後）：結果報告多出的「列號」「結果」「錯誤」，修正後直接重新上傳時自動忽略。
 */
export function mapHeaders(
  header: readonly string[],
  sets: ImportColumnSets,
  mode: ImportMode,
  explicit: (string | null)[] | null,
  knownReadOnly: ReadonlySet<string> = new Set(),
): MappingResult {
  const suggestions: HeaderSuggestion[] = header.map((text, index) => {
    const normalized = normalizeText(text);
    const column = normalized
      ? sets.importable.find((item) => matches(item, normalized))
      : undefined;
    if (column) return { index, text, suggestion: column.key };
    if (knownReadOnly.has(normalized))
      return { index, text, suggestion: null, ignored: 'readOnly' };
    if (normalized && sets.forbidden.some((item) => matches(item, normalized))) {
      return { index, text, suggestion: null, ignored: 'forbidden' };
    }
    if (normalized && sets.readOnly.some((item) => matches(item, normalized))) {
      return { index, text, suggestion: null, ignored: 'readOnly' };
    }
    return { index, text, suggestion: null };
  });

  const mapping = explicit ?? suggestions.map((item) => item.suggestion);
  const ignored: { header: string; reason: IgnoreReason }[] = [];
  let unknown = false;
  const counts = new Map<string, number>();
  mapping.forEach((key, index) => {
    const item = suggestions[index];
    if (key) {
      counts.set(key, (counts.get(key) ?? 0) + 1);
      return;
    }
    if (!item || item.text.trim() === '') return;
    if (item.ignored) ignored.push({ header: item.text, reason: item.ignored });
    else if (explicit) ignored.push({ header: item.text, reason: 'unmapped' });
    else unknown = true;
  });
  // 自動對應時同一個欄位出現兩次（非多值）要使用者決定
  const duplicated = [...counts].some(
    ([key, total]) => total > 1 && !sets.importable.find((column) => column.key === key)?.multiple,
  );
  const columns = sets.importable.filter((column) => counts.has(column.key));
  const all = [...sets.importable, ...sets.forbidden];
  if (unknown || duplicated || !isMappingComplete(mode, columns, all)) {
    return { complete: false, headers: suggestions };
  }
  return { complete: true, mapping, columns, ignored };
}

/** 依對應把一列的儲存格轉成 `{ columnKey: 原始字串 }`；同一個多值欄位出現在多欄時以 `;` 串接。 */
export function toCells(
  cells: readonly string[],
  mapping: readonly (string | null)[],
  columns: readonly AnyColumn[],
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const column of columns) result[column.key] = '';
  mapping.forEach((key, index) => {
    if (!key) return;
    const value = (cells[index] ?? '').trim();
    if (value === '') return;
    result[key] = result[key] ? `${result[key]}${MULTI_VALUE_SEPARATOR}${value}` : value;
  });
  return result;
}
