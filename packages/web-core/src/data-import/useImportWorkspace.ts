import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';

import { sessionStore } from '../auth';
import {
  DRAFT_SAVE_THROTTLE_MS,
  VALIDATE_BATCH_SIZE,
  VALIDATE_DEBOUNCE_MS,
} from '../data-transfer';
import type {
  AnalyzeOptions,
  ImportApi,
  ImportColumnView,
  ImportMode,
  ImportRow,
  SubmitImportRow,
} from '../data-transfer';
import { loadImportDraft, removeImportDraft, saveImportDraft } from './importDraft';
import type { ImportDraft } from './importDraft';
import {
  computeLocalIssues,
  emptyImportState,
  importReducer,
  isBlankRow,
  manualRows,
  rowIssues,
  summarize,
} from './importState';
import type { CellChange } from './importState';

export type ImportPhase = 'setup' | 'analyzing' | 'mapping' | 'preview' | 'submitting';

export interface PendingMapping {
  file: File;
  options: AnalyzeOptions;
  headers: Array<{ index: number; text: string; suggestion: string | null }>;
  samples: string[][];
  ignored: Array<{ index: number; header: string; reason: 'readOnly' | 'forbidden' }>;
  columns: ImportColumnView[];
  sheets?: string[];
}

export interface ImportWorkspaceOptions {
  api: ImportApi;
  type: string;
  mode: ImportMode;
}

/**
 * 切換模式或資源時，呼叫端以 `key` 重新掛載（狀態歸零），這裡不另外重設。
 *
 * 匯入預覽的狀態與請求（docs/architecture/backend/22-data-transfer.md §8.3）：
 * - 改完的列 300 ms 內合併成一個 `validate`（最多 1 000 列）；回應回來時那一列又被改過就丟棄，等下一次。
 * - 每次修改後（節流 2 秒）把預覽存成加密的草稿；重新整理後可以接續，恢復時全部列重新驗證。
 * - 送出套用之後刪除草稿。
 */
export function useImportWorkspace({ api, type, mode }: ImportWorkspaceOptions) {
  const [state, dispatch] = useReducer(importReducer, mode, emptyImportState);
  const [phase, setPhase] = useState<ImportPhase>('setup');
  const [mapping, setMapping] = useState<PendingMapping | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [sheets, setSheets] = useState<string[] | undefined>();
  const [draft, setDraft] = useState<{
    fileName: string | null;
    rows: number;
    savedAt: number;
  } | null>(null);
  const owner = sessionStore.getIdentity();

  // ── 草稿 ──
  useEffect(() => {
    if (!owner) return;
    let alive = true;
    void loadImportDraft(owner, type, mode).then((record) => {
      if (!alive || !record) return;
      setDraft({
        fileName: record.data.fileName,
        rows: record.data.rows.length,
        savedAt: record.savedAt,
      });
    });
    return () => {
      alive = false;
    };
  }, [mode, owner, type]);

  const resumeDraft = useCallback(async () => {
    if (!owner) return;
    const record = await loadImportDraft(owner, type, mode);
    setDraft(null);
    if (!record) return;
    const data = record.data;
    // 恢復後結果可能已過時（資料庫變了）：全部列重新驗證
    dispatch({
      type: 'load',
      mode: data.mode,
      fileName: data.fileName,
      columns: data.columns,
      ignored: data.ignored,
      rows: data.rows,
      results: Object.values(data.results),
      revalidate: true,
    });
    setPhase('preview');
  }, [mode, owner, type]);

  const discardDraft = useCallback(async () => {
    setDraft(null);
    if (owner) await removeImportDraft(owner, type, mode);
  }, [mode, owner, type]);

  const lastSaved = useRef(0);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!owner || phase !== 'preview' || state.rows.length === 0) return;
    const snapshot: ImportDraft = {
      mode: state.mode,
      fileName: state.fileName,
      columns: state.columns,
      ignored: state.ignored,
      rows: state.rows,
      results: state.results,
    };
    const wait = Math.max(0, lastSaved.current + DRAFT_SAVE_THROTTLE_MS - Date.now());
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      lastSaved.current = Date.now();
      void saveImportDraft(owner, type, snapshot);
    }, wait);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [
    owner,
    phase,
    state.columns,
    state.fileName,
    state.ignored,
    state.mode,
    state.results,
    state.rows,
    type,
  ]);

  // ── 驗證排程 ──
  const inFlight = useRef(new Map<number, number>());
  const [validating, setValidating] = useState(0);
  useEffect(() => {
    if (phase !== 'preview') return;
    const due = Object.entries(state.pending)
      .map(([rowNo, revision]) => [Number(rowNo), revision] as const)
      .filter(([rowNo, revision]) => inFlight.current.get(rowNo) !== revision);
    if (!due.length) return;
    const timer = setTimeout(() => {
      const byNo = new Map(state.rows.map((row) => [row.rowNo, row]));
      const batch = due
        .map(([rowNo, revision]) => ({ row: byNo.get(rowNo), revision }))
        .filter(
          (item): item is { row: ImportRow; revision: number } =>
            Boolean(item.row) && !isBlankRow(item.row as ImportRow),
        )
        .slice(0, VALIDATE_BATCH_SIZE);
      const sent = Object.fromEntries(batch.map(({ row, revision }) => [row.rowNo, revision]));
      // 空白列不驗證：直接當成驗證完（沒有結果）
      const blanks = due.filter(([rowNo]) => {
        const row = byNo.get(rowNo);
        return !row || isBlankRow(row);
      });
      if (blanks.length) dispatch({ type: 'validationFailed', sent: Object.fromEntries(blanks) });
      if (!batch.length) return;
      for (const { row, revision } of batch) inFlight.current.set(row.rowNo, revision);
      setValidating((count) => count + 1);
      void api
        .validate(
          type,
          state.mode,
          batch.map(({ row }) => ({ rowNo: row.rowNo, cells: row.cells })),
        )
        .then(
          (response) => dispatch({ type: 'validated', results: response.rows, sent }),
          (failure: unknown) => {
            setError(failure);
            dispatch({ type: 'validationFailed', sent });
          },
        )
        .finally(() => {
          for (const { row, revision } of batch) {
            if (inFlight.current.get(row.rowNo) === revision) inFlight.current.delete(row.rowNo);
          }
          setValidating((count) => count - 1);
        });
    }, VALIDATE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [api, phase, state.mode, state.pending, state.rows, type]);

  // ── 步驟 ──
  const analyze = useCallback(
    async (file: File, options: Omit<AnalyzeOptions, 'mode'>) => {
      setPhase('analyzing');
      setError(null);
      try {
        const analysis = await api.analyze(type, file, { ...options, mode });
        setSheets(analysis.sheets);
        if (analysis.status === 'needsMapping') {
          setMapping({
            file,
            options: { ...options, mode },
            headers: analysis.headers,
            samples: analysis.samples,
            ignored: analysis.ignored,
            columns: analysis.columns,
            sheets: analysis.sheets,
          });
          setPhase('mapping');
          return;
        }
        setMapping(null);
        dispatch({
          type: 'load',
          mode,
          fileName: analysis.fileName,
          columns: analysis.columns,
          ignored: analysis.ignored.map((item) => item.header),
          rows: analysis.rows,
          results: analysis.results,
        });
        setPhase('preview');
      } catch (failure) {
        setError(failure);
        setPhase(mapping ? 'mapping' : 'setup');
      }
    },
    [api, mapping, mode, type],
  );

  const confirmMapping = useCallback(
    (selection: Record<number, string | null>) => {
      if (!mapping) return Promise.resolve();
      return analyze(mapping.file, { ...mapping.options, mapping: selection });
    },
    [analyze, mapping],
  );

  const startManual = useCallback(
    (columns: ImportColumnView[], fileName: string) => {
      dispatch({
        type: 'load',
        mode,
        fileName,
        columns,
        ignored: [],
        rows: manualRows(columns),
        results: [],
      });
      setPhase('preview');
    },
    [mode],
  );

  /** 「以失敗的列重新匯入」：取回原始 cells 建立新的預覽，全部重新比對、重新驗證（§7.7）。 */
  const loadRows = useCallback(
    (columns: ImportColumnView[], rows: ImportRow[], fileName: string | null) => {
      dispatch({
        type: 'load',
        mode,
        fileName,
        columns,
        ignored: [],
        rows,
        results: [],
        revalidate: true,
      });
      setPhase('preview');
    },
    [mode],
  );

  const discard = useCallback(async () => {
    dispatch({ type: 'reset', mode });
    setPhase('setup');
    setMapping(null);
    if (owner) await removeImportDraft(owner, type, mode);
  }, [mode, owner, type]);

  const local = useMemo(() => computeLocalIssues(state), [state]);
  const summary = useMemo(() => summarize(state, local), [local, state]);

  /** 送出的列：空白列不送；修改模式沒有變更、也沒有錯誤的列不送（自動略過，§3）。 */
  const submittable = useMemo<SubmitImportRow[]>(
    () =>
      state.rows.flatMap((row) => {
        if (isBlankRow(row)) return [];
        const result = state.results[row.rowNo];
        const issues = rowIssues(state, local, row.rowNo);
        const hasError = issues.some((issue) => issue.severity === 'error');
        if (state.mode === 'update' && !hasError && !result?.changed?.length) return [];
        return [
          {
            rowNo: row.rowNo,
            sourceRow: row.sourceRow,
            cells: row.cells,
            ...(result?.target
              ? {
                  target: {
                    id: result.target.id,
                    version: result.target.version,
                    ...(result.target.expected ? { expected: result.target.expected } : {}),
                  },
                }
              : {}),
          },
        ];
      }),
    [local, state],
  );

  const submit = useCallback(
    async (skipInvalid: boolean) => {
      setPhase('submitting');
      setError(null);
      try {
        const transfer = await api.createImport({
          type,
          mode: state.mode,
          ...(state.fileName ? { fileName: state.fileName } : {}),
          skipInvalid,
          rows: submittable,
        });
        if (owner) await removeImportDraft(owner, type, state.mode);
        dispatch({ type: 'reset', mode: state.mode });
        setPhase('setup');
        return transfer;
      } catch (failure) {
        setError(failure);
        setPhase('preview');
        return null;
      }
    },
    [api, owner, state.fileName, state.mode, submittable, type],
  );

  return {
    state,
    phase,
    mapping,
    error,
    sheets,
    draft,
    local,
    summary,
    submittable,
    validating: validating > 0 || Object.keys(state.pending).length > 0,
    dirty: phase === 'preview' && state.rows.some((row) => !isBlankRow(row)),
    analyze,
    confirmMapping,
    cancelMapping: () => {
      setMapping(null);
      setPhase('setup');
    },
    startManual,
    loadRows,
    resumeDraft,
    discardDraft,
    discard,
    submit,
    clearError: () => setError(null),
    edit: (changes: CellChange[]) => dispatch({ type: 'editCells', changes }),
    addRow: () => dispatch({ type: 'addRows', count: 1 }),
    removeRows: (rowNos: number[]) => dispatch({ type: 'removeRows', rowNos }),
    undo: () => dispatch({ type: 'undo' }),
    redo: () => dispatch({ type: 'redo' }),
    revalidateAll: () => dispatch({ type: 'revalidateAll' }),
  };
}

export type ImportWorkspaceModel = ReturnType<typeof useImportWorkspace>;
