import { IMPORT_HISTORY_LIMIT, MANUAL_ROW_COUNT } from '../data-transfer';
import type {
  ImportColumnView,
  ImportMode,
  ImportRow,
  ManualTarget,
  RowIssue,
  RowValidation,
} from '../data-transfer';

/**
 * 匯入預覽的狀態（docs/architecture/backend/22-data-transfer.md §8.3）：前端持有分析回傳的 JSON，編輯就是改這裡的 `cells`；
 * 每個動作都是純函式（可以單獨測試）。驗證結果以「送出時的修改序號」比對：回來時那一列又被改過，就丟棄這次的結果。
 *
 * 只用可以序列化的結構（物件、陣列），整份狀態直接存成草稿。
 */
export interface ImportState {
  mode: ImportMode;
  /** 檔名（直接輸入時是 null）。 */
  fileName: string | null;
  columns: ImportColumnView[];
  /** 不會匯入的標頭（唯讀、沒有權限、使用者選擇忽略）。 */
  ignored: string[];
  /** 依 rowNo 遞增。 */
  rows: ImportRow[];
  /** rowNo → 後端的驗證結果。 */
  results: Record<number, RowValidation>;
  /** rowNo → 修改序號：每次改到這一列就加一。 */
  revisions: Record<number, number>;
  /** 已修改、還沒拿到驗證結果的列：rowNo → 需要驗證的修改序號。 */
  pending: Record<number, number>;
  history: { undo: Edit[]; redo: Edit[] };
}

/** 一次編輯：受影響的列在編輯前後的樣子（`null` = 不存在）。復原與重做就是套回其中一邊。 */
export interface Edit {
  before: Array<ImportRow | null>;
  after: Array<ImportRow | null>;
  rowNos: number[];
}

export interface CellChange {
  rowNo: number;
  key: string;
  value: string;
}

export type ImportAction =
  | {
      type: 'load';
      mode: ImportMode;
      fileName: string | null;
      columns: ImportColumnView[];
      ignored: string[];
      rows: ImportRow[];
      results: RowValidation[];
      /** 草稿恢復、重新比對：全部列都要重新驗證。 */
      revalidate?: boolean;
    }
  | { type: 'editCells'; changes: CellChange[] }
  /** 修改模式的比對目標：`undefined` 改回自動比對、`null` 撤回比對、物件是手動指定（可以復原）。 */
  | { type: 'setTarget'; rowNo: number; target: ManualTarget | null | undefined }
  | { type: 'addRows'; count: number }
  | { type: 'removeRows'; rowNos: number[] }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'validated'; results: RowValidation[]; sent: Record<number, number> }
  | { type: 'validationFailed'; sent: Record<number, number> }
  | { type: 'revalidateAll' }
  | { type: 'reset'; mode: ImportMode };

export function emptyImportState(mode: ImportMode): ImportState {
  return {
    mode,
    fileName: null,
    columns: [],
    ignored: [],
    rows: [],
    results: {},
    revisions: {},
    pending: {},
    history: { undo: [], redo: [] },
  };
}

function blankCells(columns: readonly ImportColumnView[]): Record<string, string> {
  return Object.fromEntries(columns.map((column) => [column.key, '']));
}

/** 「不上傳，直接輸入」：20 列空白的 JSON（不呼叫分析）。 */
export function manualRows(columns: readonly ImportColumnView[]): ImportRow[] {
  return Array.from({ length: MANUAL_ROW_COUNT }, (_, index) => ({
    rowNo: index + 1,
    sourceRow: null,
    cells: blankCells(columns),
  }));
}

/** 空白列：所有儲存格都沒填。手動新增但沒填的列不送去驗證、也不套用。 */
export function isBlankRow(row: ImportRow): boolean {
  return Object.values(row.cells).every((value) => value.trim() === '');
}

function bump(state: ImportState, rowNos: readonly number[]) {
  const revisions = { ...state.revisions };
  const pending = { ...state.pending };
  for (const rowNo of rowNos) {
    revisions[rowNo] = (revisions[rowNo] ?? 0) + 1;
    pending[rowNo] = revisions[rowNo];
  }
  return { revisions, pending };
}

/** 套用一組列的快照（`null` 刪除）；保持 rowNo 遞增。 */
function applyRows(
  rows: readonly ImportRow[],
  rowNos: readonly number[],
  snapshots: ReadonlyArray<ImportRow | null>,
) {
  const byNo = new Map(rows.map((row) => [row.rowNo, row]));
  rowNos.forEach((rowNo, index) => {
    const snapshot = snapshots[index];
    if (snapshot) byNo.set(rowNo, snapshot);
    else byNo.delete(rowNo);
  });
  return [...byNo.values()].toSorted((a, b) => a.rowNo - b.rowNo);
}

function record(state: ImportState, edit: Edit): ImportState['history'] {
  return { undo: [...state.history.undo, edit].slice(-IMPORT_HISTORY_LIMIT), redo: [] };
}

/**
 * 同檔引用（docs/architecture/backend/22-data-transfer.md §7.8）：被引用的欄（例：部門的代碼）改了、或那一列新增或移除，
 * 引用舊值或新值的其他列也要重新驗證（它們原本對得上或對不上的結果變了）。
 */
function sameFileDependents(
  columns: readonly ImportColumnView[],
  edit: Edit,
  rows: readonly ImportRow[],
): number[] {
  const referencing = columns.filter((column) => column.sameFile);
  if (!referencing.length) return [];
  const touched = new Set(edit.rowNos);
  const dependents = new Set<number>();
  for (const column of referencing) {
    const target = column.sameFile ?? '';
    const changed = new Set<string>();
    edit.rowNos.forEach((_, index) => {
      const before = normalize(edit.before[index]?.cells[target] ?? '');
      const after = normalize(edit.after[index]?.cells[target] ?? '');
      if (before === after) return;
      if (before) changed.add(before);
      if (after) changed.add(after);
    });
    if (!changed.size) continue;
    for (const row of rows) {
      if (touched.has(row.rowNo) || isBlankRow(row)) continue;
      if (changed.has(normalize(row.cells[column.key] ?? ''))) dependents.add(row.rowNo);
    }
  }
  return [...dependents];
}

/**
 * 驗證一批列時要帶的 `fileKeys`：這批列引用到、而且檔案裡有的值（被引用的欄 → 原始文字）。
 * `validate` 只收到被改的列，看不到整份檔案；只帶引用到的值，請求才不會隨檔案變大。
 */
export function fileKeysFor(
  state: Pick<ImportState, 'mode' | 'columns' | 'rows'>,
  batch: readonly ImportRow[],
): Record<string, string[]> | undefined {
  if (state.mode !== 'create') return undefined;
  const result: Record<string, string[]> = {};
  for (const column of state.columns.filter((item) => item.sameFile)) {
    const target = column.sameFile ?? '';
    const inFile = new Map<string, string>();
    for (const row of state.rows) {
      const text = (row.cells[target] ?? '').trim();
      if (text) inFile.set(normalize(text), text);
    }
    const wanted = new Set<string>();
    for (const row of batch) {
      const text = inFile.get(normalize(row.cells[column.key] ?? ''));
      if (text) wanted.add(text);
    }
    if (wanted.size) result[target] = [...new Set([...(result[target] ?? []), ...wanted])];
  }
  return Object.keys(result).length ? result : undefined;
}

function commit(state: ImportState, edit: Edit, history: ImportState['history']): ImportState {
  const rows = applyRows(state.rows, edit.rowNos, edit.after);
  const existing = new Set(rows.map((row) => row.rowNo));
  const { revisions, pending } = bump(state, [
    ...edit.rowNos.filter((rowNo) => existing.has(rowNo)),
    ...sameFileDependents(state.columns, edit, rows),
  ]);
  // 移除的列：結果與待驗證一起拿掉
  const results = { ...state.results };
  for (const rowNo of edit.rowNos) {
    if (!existing.has(rowNo)) {
      delete results[rowNo];
      delete pending[rowNo];
    }
  }
  return { ...state, rows, revisions, pending, results, history };
}

export function importReducer(state: ImportState, action: ImportAction): ImportState {
  switch (action.type) {
    case 'load': {
      const rows = action.rows.toSorted((a, b) => a.rowNo - b.rowNo);
      const results = Object.fromEntries(action.results.map((result) => [result.rowNo, result]));
      const revisions = Object.fromEntries(rows.map((row) => [row.rowNo, 0]));
      const pending = action.revalidate
        ? Object.fromEntries(rows.filter((row) => !isBlankRow(row)).map((row) => [row.rowNo, 0]))
        : {};
      return {
        mode: action.mode,
        fileName: action.fileName,
        columns: action.columns,
        ignored: action.ignored,
        rows,
        results,
        revisions,
        pending,
        history: { undo: [], redo: [] },
      };
    }
    case 'editCells': {
      const byNo = new Map(state.rows.map((row) => [row.rowNo, row]));
      const next = new Map<number, ImportRow>();
      for (const change of action.changes) {
        const row = next.get(change.rowNo) ?? byNo.get(change.rowNo);
        if (!row || (row.cells[change.key] ?? '') === change.value) continue;
        next.set(change.rowNo, { ...row, cells: { ...row.cells, [change.key]: change.value } });
      }
      if (next.size === 0) return state;
      const rowNos = [...next.keys()];
      const edit: Edit = {
        rowNos,
        before: rowNos.map((rowNo) => byNo.get(rowNo) ?? null),
        after: rowNos.map((rowNo) => next.get(rowNo) ?? null),
      };
      return commit(state, edit, record(state, edit));
    }
    case 'setTarget': {
      const row = state.rows.find((item) => item.rowNo === action.rowNo);
      if (!row || sameTarget(row.target, action.target)) return state;
      const next: ImportRow = {
        rowNo: row.rowNo,
        sourceRow: row.sourceRow,
        cells: row.cells,
        ...(action.target === undefined ? {} : { target: action.target }),
      };
      const edit: Edit = { rowNos: [row.rowNo], before: [row], after: [next] };
      return commit(state, edit, record(state, edit));
    }
    case 'addRows': {
      const last = state.rows.at(-1)?.rowNo ?? 0;
      const added = Array.from({ length: action.count }, (_, index) => ({
        rowNo: last + index + 1,
        sourceRow: null,
        cells: blankCells(state.columns),
      }));
      const edit: Edit = {
        rowNos: added.map((row) => row.rowNo),
        before: added.map(() => null),
        after: added,
      };
      const committed = commit(state, edit, record(state, edit));
      // 空白列不必驗證
      const pending = { ...committed.pending };
      for (const row of added) delete pending[row.rowNo];
      return { ...committed, pending };
    }
    case 'removeRows': {
      const byNo = new Map(state.rows.map((row) => [row.rowNo, row]));
      const rowNos = action.rowNos.filter((rowNo) => byNo.has(rowNo));
      if (!rowNos.length) return state;
      const edit: Edit = {
        rowNos,
        before: rowNos.map((rowNo) => byNo.get(rowNo) ?? null),
        after: rowNos.map(() => null),
      };
      return commit(state, edit, record(state, edit));
    }
    case 'undo': {
      const edit = state.history.undo.at(-1);
      if (!edit) return state;
      const reverse: Edit = { rowNos: edit.rowNos, before: edit.after, after: edit.before };
      return commit(state, reverse, {
        undo: state.history.undo.slice(0, -1),
        redo: [...state.history.redo, edit],
      });
    }
    case 'redo': {
      const edit = state.history.redo.at(-1);
      if (!edit) return state;
      return commit(state, edit, {
        undo: [...state.history.undo, edit],
        redo: state.history.redo.slice(0, -1),
      });
    }
    case 'validated': {
      const results = { ...state.results };
      const pending = { ...state.pending };
      for (const result of action.results) {
        const sent = action.sent[result.rowNo];
        // 回應回來時這一列又被改過：丟棄，等下一次
        if (sent === undefined || state.revisions[result.rowNo] !== sent) continue;
        results[result.rowNo] = result;
        if (pending[result.rowNo] === sent) delete pending[result.rowNo];
      }
      return { ...state, results, pending };
    }
    case 'validationFailed': {
      // 驗證請求失敗：保留舊的結果、不再自動重送（使用者再改一次或按「重新比對」）
      const pending = { ...state.pending };
      for (const [rowNo, sent] of Object.entries(action.sent)) {
        if (pending[Number(rowNo)] === sent) delete pending[Number(rowNo)];
      }
      return { ...state, pending };
    }
    case 'revalidateAll': {
      const pending = Object.fromEntries(
        state.rows
          .filter((row) => !isBlankRow(row))
          .map((row) => [row.rowNo, state.revisions[row.rowNo] ?? 0]),
      );
      return { ...state, pending };
    }
    case 'reset':
      return emptyImportState(action.mode);
  }
}

function sameTarget(
  a: ManualTarget | null | undefined,
  b: ManualTarget | null | undefined,
): boolean {
  if (a === undefined || a === null || b === undefined || b === null) return a === b;
  return a.id === b.id;
}

/** 送去驗證、套用時的 `targetId`：自動比對時不帶。 */
export function targetIdOf(row: ImportRow): { targetId?: string | null } {
  if (row.target === undefined) return {};
  return { targetId: row.target?.id ?? null };
}

/** 正規化後比對（與後端相同：全形轉半形、去空白、小寫、壓縮空白）。 */
function normalize(value: string): string {
  return value.normalize('NFKC').trim().replaceAll(/\s+/g, ' ').toLowerCase();
}

/**
 * 檔案內重複與同一個目標多次（D23）：`validate` 只收到被改的列，看不到整份資料，所以在前端整份 JSON 上計算；
 * 規則的依據（唯一欄、比對結果）來自後端。套用工作會在伺服器端再算一次。
 */
export function computeLocalIssues(
  state: Pick<ImportState, 'mode' | 'columns' | 'rows' | 'results'>,
): Map<number, RowIssue[]> {
  const issues = new Map<number, RowIssue[]>();
  const push = (rowNo: number, issue: RowIssue) =>
    issues.set(rowNo, [...(issues.get(rowNo) ?? []), issue]);
  for (const column of state.columns.filter((item) => item.unique)) {
    const seen = new Map<string, number[]>();
    for (const row of state.rows) {
      const value = normalize(row.cells[column.key] ?? '').replace(/^'/, '');
      if (!value) continue;
      seen.set(value, [...(seen.get(value) ?? []), row.rowNo]);
    }
    for (const rowNos of seen.values()) {
      if (rowNos.length < 2) continue;
      for (const rowNo of rowNos) {
        push(rowNo, {
          column: column.key,
          code: 'duplicateInFile',
          params: { rows: rowNos.filter((other) => other !== rowNo) },
          severity: 'error',
        });
      }
    }
  }
  if (state.mode === 'update') {
    const targets = new Map<string, number[]>();
    for (const row of state.rows) {
      const target = state.results[row.rowNo]?.target?.id;
      if (target) targets.set(target, [...(targets.get(target) ?? []), row.rowNo]);
    }
    for (const rowNos of targets.values()) {
      if (rowNos.length < 2) continue;
      for (const rowNo of rowNos) {
        push(rowNo, {
          column: null,
          code: 'duplicateTarget',
          params: { rows: rowNos.filter((other) => other !== rowNo) },
          severity: 'error',
        });
      }
    }
  }
  return issues;
}

export type RowStatus = 'error' | 'warning' | 'changed' | 'unchanged' | 'ok' | 'pending' | 'blank';

/** 一列的全部問題（後端的結果＋前端計算的）。 */
export function rowIssues(
  state: ImportState,
  local: ReadonlyMap<number, RowIssue[]>,
  rowNo: number,
): RowIssue[] {
  return [...(state.results[rowNo]?.issues ?? []), ...(local.get(rowNo) ?? [])];
}

export function rowStatus(
  state: ImportState,
  local: ReadonlyMap<number, RowIssue[]>,
  row: ImportRow,
): RowStatus {
  if (isBlankRow(row)) return 'blank';
  if (state.pending[row.rowNo] !== undefined) return 'pending';
  const issues = rowIssues(state, local, row.rowNo);
  if (issues.some((issue) => issue.severity === 'error')) return 'error';
  if (state.mode === 'update') {
    const result = state.results[row.rowNo];
    if (result?.changed?.length) return issues.length ? 'warning' : 'changed';
    if (result?.target) return 'unchanged';
  }
  if (issues.length) return 'warning';
  return state.results[row.rowNo] ? 'ok' : 'pending';
}

export interface ImportSummary {
  total: number;
  errors: number;
  warnings: number;
  changed: number;
  unchanged: number;
  pending: number;
  /** 會送出套用的列（不含空白列；修改模式不含沒有變更的列）。 */
  applicable: number;
}

export function summarize(
  state: ImportState,
  local: ReadonlyMap<number, RowIssue[]>,
): ImportSummary {
  const summary: ImportSummary = {
    total: 0,
    errors: 0,
    warnings: 0,
    changed: 0,
    unchanged: 0,
    pending: 0,
    applicable: 0,
  };
  for (const row of state.rows) {
    const status = rowStatus(state, local, row);
    if (status === 'blank') continue;
    summary.total += 1;
    if (status === 'error') summary.errors += 1;
    if (status === 'warning') summary.warnings += 1;
    if (status === 'changed') summary.changed += 1;
    if (status === 'unchanged') summary.unchanged += 1;
    if (status === 'pending') summary.pending += 1;
    if (status !== 'unchanged') summary.applicable += 1;
  }
  return summary;
}
