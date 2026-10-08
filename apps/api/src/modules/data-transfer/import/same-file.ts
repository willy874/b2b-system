import type { AnyColumn } from '../data-transfer.columns';
import type { AnyTransferResource } from '../data-transfer.types';
import { cleanText, normalizeText } from '../data-transfer.values';

/**
 * 同一份檔案內的引用（docs/architecture/backend/22-data-transfer.md §7.8）：新增模式中，參照欄的值對不上資料庫、
 * 但等於檔案裡另一列 `sameFile.column` 欄的值時，先放一個佔位值，套用時換成那一列建立出來的 id。
 */

const SAME_FILE = Symbol('sameFile');

/** 參照欄的佔位值：`key` 是被引用的值（正規化後）。 */
export interface SameFileRef {
  readonly [SAME_FILE]: true;
  readonly key: string;
}

export function sameFileRef(key: string): SameFileRef {
  return { [SAME_FILE]: true, key };
}

export function isSameFileRef(value: unknown): value is SameFileRef {
  return typeof value === 'object' && value !== null && SAME_FILE in value;
}

/** 可以同檔引用的參照欄（只在新增模式）。 */
export function sameFileColumns(resource: AnyTransferResource): AnyColumn[] {
  return resource.columns.filter((column) => column.reference?.sameFile);
}

/** 一列在被引用的欄位上的值（正規化後；沒填是 null）。 */
export function sameFileKeyOf(
  cells: Readonly<Record<string, string>>,
  column: string,
): string | null {
  const text = normalizeText(cleanText(cells[column] ?? ''));
  return text || null;
}

/**
 * 檔案裡可以被引用的值：`column`（被引用的欄）→ 值的集合。預覽的 `validate` 只送改過的列，
 * 所以前端另外帶上「這批列引用到、而且檔案裡確實有」的值（`extra`）。
 */
export function collectFileKeys(
  resource: AnyTransferResource,
  inputs: ReadonlyArray<{ cells: Readonly<Record<string, string>> }>,
  extra: Readonly<Record<string, readonly string[]>> = {},
): Map<string, Set<string>> {
  const keys = new Map<string, Set<string>>();
  for (const column of sameFileColumns(resource)) {
    const target = column.reference?.sameFile?.column;
    if (!target || keys.has(target)) continue;
    const values = new Set<string>();
    for (const input of inputs) {
      const key = sameFileKeyOf(input.cells, target);
      if (key) values.add(key);
    }
    for (const value of extra[target] ?? []) {
      const key = normalizeText(cleanText(value));
      if (key) values.add(key);
    }
    keys.set(target, values);
  }
  return keys;
}

export interface SameFilePlan<TRow> {
  /** 被引用的列排在引用它的列之前；其餘維持原本的順序。 */
  ordered: TRow[];
  /** 在循環裡的列（含引用自己的）：不能套用。引用它們的列不在這裡，套用時因找不到被引用的 id 而失敗。 */
  cyclic: Set<TRow>;
}

/**
 * 依同檔引用排出套用順序（拓撲排序，穩定：沒有相依的列維持列號順序）。`refsOf` 回傳一列引用的值，
 * `keyOf` 回傳一列可以被引用的值；引用到不在這批列裡的值（已經建立、或這一列不會套用）不算相依。
 */
export function planSameFile<TRow>(
  rows: readonly TRow[],
  refsOf: (row: TRow) => readonly string[],
  keyOf: (row: TRow) => readonly string[],
): SameFilePlan<TRow> {
  const owner = new Map<string, TRow>();
  for (const row of rows) for (const key of keyOf(row)) owner.set(key, row);
  const dependsOn = new Map<TRow, TRow[]>(
    rows.map((row) => [
      row,
      refsOf(row).flatMap((key) => {
        const target = owner.get(key);
        return target ? [target] : [];
      }),
    ]),
  );

  const ordered: TRow[] = [];
  const cyclic = new Set<TRow>();
  const state = new Map<TRow, 'visiting' | 'done'>();
  const visit = (row: TRow, path: TRow[]): void => {
    const current = state.get(row);
    if (current === 'done') return;
    if (current === 'visiting') {
      // 從第一次進入這一列開始的路徑都在循環裡
      for (const item of path.slice(path.indexOf(row))) cyclic.add(item);
      return;
    }
    state.set(row, 'visiting');
    for (const target of dependsOn.get(row) ?? []) visit(target, [...path, row]);
    state.set(row, 'done');
    ordered.push(row);
  };
  for (const row of rows) visit(row, []);
  // 引用循環裡的列的列照常排序：套用時找不到被引用的 id，以 `referenceFailed` 失敗
  return { ordered: ordered.filter((row) => !cyclic.has(row)), cyclic };
}
