import { describe, expect, it } from 'vitest';

import type { ImportColumnView, RowValidation } from '../../data-transfer';
import {
  computeLocalIssues,
  emptyImportState,
  importReducer,
  manualRows,
  rowStatus,
  summarize,
  targetIdOf,
} from '../importState';
import type { ImportAction, ImportState } from '../importState';

function column(key: string, overrides: Partial<ImportColumnView> = {}): ImportColumnView {
  return {
    key,
    label: key,
    kind: 'string',
    required: false,
    multiple: false,
    matchKey: null,
    unique: false,
    nullable: false,
    suggest: false,
    hint: null,
    options: null,
    transitions: null,
    ...overrides,
  };
}

const COLUMNS = [column('email', { unique: true, required: true }), column('name')];

function loaded(mode: 'create' | 'update' = 'create', results: RowValidation[] = []): ImportState {
  return importReducer(emptyImportState(mode), {
    type: 'load',
    mode,
    fileName: 'users.csv',
    columns: COLUMNS,
    ignored: [],
    rows: [
      { rowNo: 1, sourceRow: 2, cells: { email: 'a@example.com', name: 'A' } },
      { rowNo: 2, sourceRow: 3, cells: { email: 'b@example.com', name: 'B' } },
    ],
    results,
  });
}

function run(state: ImportState, ...actions: ImportAction[]): ImportState {
  return actions.reduce(importReducer, state);
}

describe('匯入預覽的狀態（docs/architecture/backend/22-data-transfer.md §8.3）', () => {
  it('編輯改 cells、該列進入待驗證、可以復原與重做', () => {
    const edited = run(loaded(), {
      type: 'editCells',
      changes: [{ rowNo: 1, key: 'name', value: 'Alice' }],
    });
    expect(edited.rows[0]?.cells.name).toBe('Alice');
    expect(edited.pending).toEqual({ 1: 1 });

    const undone = run(edited, { type: 'undo' });
    expect(undone.rows[0]?.cells.name).toBe('A');
    expect(undone.history.redo).toHaveLength(1);

    const redone = run(undone, { type: 'redo' });
    expect(redone.rows[0]?.cells.name).toBe('Alice');
  });

  it('同樣的值不算編輯；一次貼上多格是一次編輯', () => {
    const same = loaded();
    expect(run(same, { type: 'editCells', changes: [{ rowNo: 1, key: 'name', value: 'A' }] })).toBe(
      same,
    );
    const pasted = run(same, {
      type: 'editCells',
      changes: [
        { rowNo: 1, key: 'name', value: 'X' },
        { rowNo: 2, key: 'name', value: 'Y' },
      ],
    });
    expect(pasted.history.undo).toHaveLength(1);
    expect(Object.keys(pasted.pending)).toEqual(['1', '2']);
  });

  it('驗證結果回來時那一列又被改過：丟棄，等下一次', () => {
    const first = run(loaded(), {
      type: 'editCells',
      changes: [{ rowNo: 1, key: 'name', value: 'X' }],
    });
    const sent = { 1: first.revisions[1] ?? 0 };
    const again = run(first, {
      type: 'editCells',
      changes: [{ rowNo: 1, key: 'name', value: 'Y' }],
    });
    const stale = run(again, {
      type: 'validated',
      sent,
      results: [{ rowNo: 1, issues: [{ column: 'name', code: 'tooShort', severity: 'error' }] }],
    });
    expect(stale.results[1]).toBeUndefined();
    expect(stale.pending[1]).toBe(2);

    const fresh = run(again, {
      type: 'validated',
      sent: { 1: 2 },
      results: [{ rowNo: 1, issues: [] }],
    });
    expect(fresh.results[1]).toEqual({ rowNo: 1, issues: [] });
    expect(fresh.pending[1]).toBeUndefined();
  });

  it('新增的空白列不驗證；移除列一併拿掉結果，可以復原', () => {
    const added = run(loaded(), { type: 'addRows', count: 1 });
    expect(added.rows.map((row) => row.rowNo)).toEqual([1, 2, 3]);
    expect(added.pending).toEqual({});

    const withResult = run(loaded('create', [{ rowNo: 2, issues: [] }]), {
      type: 'removeRows',
      rowNos: [2],
    });
    expect(withResult.rows.map((row) => row.rowNo)).toEqual([1]);
    expect(withResult.results[2]).toBeUndefined();
    expect(run(withResult, { type: 'undo' }).rows.map((row) => row.rowNo)).toEqual([1, 2]);
  });

  it('檔案內重複（唯一欄，正規化後比對）由前端在整份 JSON 上計算', () => {
    const state = run(loaded(), {
      type: 'editCells',
      changes: [{ rowNo: 2, key: 'email', value: ' A@EXAMPLE.com ' }],
    });
    const local = computeLocalIssues(state);
    expect(local.get(1)).toEqual([
      { column: 'email', code: 'duplicateInFile', params: { rows: [2] }, severity: 'error' },
    ]);
    expect(local.get(2)?.[0]?.params).toEqual({ rows: [1] });
  });

  it('修改模式：同一個目標出現多次是錯誤；沒有變更的列不算要套用', () => {
    const target = { id: 't1', label: 'a@example.com', version: 1, current: {} };
    const state = loaded('update', [
      { rowNo: 1, issues: [], target, changed: ['name'] },
      {
        rowNo: 2,
        issues: [{ column: null, code: 'noChanges', severity: 'warning' }],
        target,
        changed: [],
      },
    ]);
    const local = computeLocalIssues(state);
    expect(local.get(1)?.map((issue) => issue.code)).toEqual(['duplicateTarget']);
    expect(rowStatus(state, local, state.rows[0]!)).toBe('error');
    const summary = summarize(state, new Map());
    expect(summary).toMatchObject({ total: 2, changed: 1, unchanged: 1, applicable: 1 });
  });

  it('直接輸入：20 列空白、不在摘要裡', () => {
    const rows = manualRows(COLUMNS);
    expect(rows).toHaveLength(20);
    const state = importReducer(emptyImportState('create'), {
      type: 'load',
      mode: 'create',
      fileName: null,
      columns: COLUMNS,
      ignored: [],
      rows,
      results: [],
      revalidate: true,
    });
    expect(state.pending).toEqual({});
    expect(summarize(state, new Map()).total).toBe(0);
  });

  it('比對目標：手動指定、撤回、改回自動比對都是一次編輯（可以復原），該列重新驗證', () => {
    const target = { id: 'u-2', label: 'b@example.com' };
    const picked = run(loaded('update'), { type: 'setTarget', rowNo: 1, target });
    expect(picked.rows[0]?.target).toEqual(target);
    expect(targetIdOf(picked.rows[0]!)).toEqual({ targetId: 'u-2' });
    expect(picked.pending).toEqual({ 1: 1 });
    // 同一個目標不算編輯
    expect(run(picked, { type: 'setTarget', rowNo: 1, target: { ...target } })).toBe(picked);

    const revoked = run(picked, { type: 'setTarget', rowNo: 1, target: null });
    expect(targetIdOf(revoked.rows[0]!)).toEqual({ targetId: null });

    const auto = run(revoked, { type: 'setTarget', rowNo: 1, target: undefined });
    expect(auto.rows[0]).not.toHaveProperty('target');
    expect(targetIdOf(auto.rows[0]!)).toEqual({});

    expect(run(auto, { type: 'undo' }).rows[0]?.target).toBeNull();
    expect(run(auto, { type: 'undo' }, { type: 'undo' }).rows[0]?.target).toEqual(target);
  });
});
