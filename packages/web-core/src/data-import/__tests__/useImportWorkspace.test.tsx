import { createDraftStore } from '@b2b-system/web-shared/storage';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { sessionStore } from '../../auth';
import type { ImportAnalysis, ImportApi, ImportMode, RowValidation } from '../../data-transfer';
import { setImportDraftStore } from '../../form';
import { loadImportDraft, removeImportDraft, saveImportDraft } from '../importDraft';
import { useImportWorkspace } from '../useImportWorkspace';
import { COLUMNS, fakeImportApi, importColumn, signIn } from './fakeImportApi';

const WAIT = { timeout: 5000 };
const FILE = new File(['email'], 'users.csv', { type: 'text/csv' });

function renderWorkspace(api: ImportApi, mode: ImportMode = 'create') {
  return renderHook(() => useImportWorkspace({ api, type: 'user', mode }));
}

async function analyzed(api: ImportApi, mode: ImportMode = 'create') {
  const view = renderWorkspace(api, mode);
  await act(() => view.result.current.analyze(FILE, { encoding: 'auto' }));
  return view;
}

/** 修改模式的分析：第 1 列有變更（Email 改了），第 2 列沒有變更。 */
function updateAnalysis(): ImportAnalysis {
  const target = (id: string, email: string) => ({
    id,
    label: email,
    version: 3,
    current: { email },
  });
  return {
    status: 'ok',
    fileName: 'fix.csv',
    columns: COLUMNS,
    ignored: [{ header: 'id', reason: 'readOnly' }],
    rows: [
      { rowNo: 1, sourceRow: 2, cells: { email: 'new@example.com' } },
      { rowNo: 2, sourceRow: 3, cells: { email: 'same@example.com' } },
    ],
    results: [
      { rowNo: 1, issues: [], target: target('u1', 'old@example.com'), changed: ['email'] },
      { rowNo: 2, issues: [], target: target('u2', 'same@example.com'), changed: [] },
    ],
  };
}

beforeEach(() => {
  setImportDraftStore(createDraftStore({ indexedDB: undefined }));
});

afterEach(() => {
  setImportDraftStore(undefined);
  sessionStore.clear();
});

describe('useImportWorkspace（匯入預覽的步驟，docs/architecture/frontend/21-data-transfer.md §4）', () => {
  it('分析成功：進入預覽，列與驗證結果載入，摘要算出錯誤列', async () => {
    const api = fakeImportApi();
    const { result } = await analyzed(api);

    expect(api.analyze).toHaveBeenCalledWith('user', FILE, { encoding: 'auto', mode: 'create' });
    expect(result.current.phase).toBe('preview');
    expect(result.current.state.fileName).toBe('users.csv');
    expect(result.current.summary).toMatchObject({ total: 2, errors: 1 });
    expect(result.current.dirty).toBe(true);
  });

  it('分析失敗：回到上傳步驟，保留錯誤；clearError 清掉', async () => {
    const failure = new Error('bad file');
    const { result } = await analyzed(
      fakeImportApi({ analyze: vi.fn().mockRejectedValue(failure) }),
    );

    expect(result.current.phase).toBe('setup');
    expect(result.current.error).toBe(failure);

    act(() => result.current.clearError());
    expect(result.current.error).toBeNull();
  });

  describe('對應欄位', () => {
    const needsMapping: ImportAnalysis = {
      status: 'needsMapping',
      fileName: 'users.csv',
      headers: [{ index: 0, text: '電子郵件', suggestion: 'email' }],
      samples: [['a@example.com']],
      ignored: [],
      columns: COLUMNS,
      sheets: ['Sheet1', 'Sheet2'],
    };

    it('有對不上的標頭時進入對應步驟；確認後以同一個檔案加上 mapping 再分析', async () => {
      const analyze = vi
        .fn<ImportApi['analyze']>()
        .mockResolvedValueOnce(needsMapping)
        .mockImplementation(fakeImportApi().analyze);
      const { result } = await analyzed(fakeImportApi({ analyze }));

      expect(result.current.phase).toBe('mapping');
      expect(result.current.mapping?.headers).toEqual(needsMapping.headers);
      expect(result.current.sheets).toEqual(['Sheet1', 'Sheet2']);

      await act(() => result.current.confirmMapping({ 0: 'email' }));

      expect(analyze).toHaveBeenLastCalledWith('user', FILE, {
        encoding: 'auto',
        mode: 'create',
        mapping: { 0: 'email' },
      });
      expect(result.current.phase).toBe('preview');
      expect(result.current.mapping).toBeNull();
    });

    it('對應後再分析失敗時留在對應步驟', async () => {
      const failure = new Error('still bad');
      const analyze = vi
        .fn<ImportApi['analyze']>()
        .mockResolvedValueOnce(needsMapping)
        .mockRejectedValueOnce(failure);
      const { result } = await analyzed(fakeImportApi({ analyze }));

      await act(() => result.current.confirmMapping({ 0: null }));

      expect(result.current.phase).toBe('mapping');
      expect(result.current.error).toBe(failure);
    });

    it('取消對應回到上傳步驟；沒有待對應的檔案時 confirmMapping 不做事', async () => {
      const analyze = vi.fn<ImportApi['analyze']>().mockResolvedValueOnce(needsMapping);
      const { result } = await analyzed(fakeImportApi({ analyze }));

      act(() => result.current.cancelMapping());
      expect(result.current.phase).toBe('setup');
      expect(result.current.mapping).toBeNull();

      await act(() => result.current.confirmMapping({}));
      expect(analyze).toHaveBeenCalledTimes(1);
    });
  });

  it('直接輸入：建立空白列；空白列不算未儲存、不驗證、不送出', async () => {
    const api = fakeImportApi();
    const { result } = renderWorkspace(api);

    act(() => result.current.startManual(COLUMNS, '直接輸入'));

    expect(result.current.phase).toBe('preview');
    expect(result.current.state.rows.length).toBeGreaterThan(0);
    expect(result.current.dirty).toBe(false);
    expect(result.current.submittable).toEqual([]);
  });

  it('編輯後該列進入驗證中，合併送出 validate，結果回來後更新', async () => {
    let resolve: (value: { rows: RowValidation[] }) => void = () => undefined;
    const validate = vi.fn(
      () =>
        new Promise<{ rows: RowValidation[] }>((done) => {
          resolve = done;
        }),
    );
    const { result } = await analyzed(fakeImportApi({ validate }));

    act(() => result.current.edit([{ rowNo: 2, key: 'email', value: 'b@example.com' }]));
    expect(result.current.validating).toBe(true);

    await waitFor(() => expect(validate).toHaveBeenCalled(), WAIT);
    expect(validate).toHaveBeenCalledWith(
      'user',
      'create',
      [{ rowNo: 2, cells: { email: 'b@example.com' } }],
      undefined,
    );
    act(() => resolve({ rows: [{ rowNo: 2, issues: [] }] }));

    await waitFor(() => expect(result.current.validating).toBe(false), WAIT);
    expect(result.current.summary.errors).toBe(0);
  });

  it('驗證失敗時保留錯誤，該列不再停在驗證中', async () => {
    const failure = new Error('network');
    const { result } = await analyzed(
      fakeImportApi({ validate: vi.fn().mockRejectedValue(failure) }),
    );

    act(() => result.current.edit([{ rowNo: 1, key: 'email', value: 'c@example.com' }]));

    await waitFor(() => expect(result.current.error).toBe(failure), WAIT);
    await waitFor(() => expect(result.current.validating).toBe(false), WAIT);
  });

  it('清成空白的列不送驗證，直接視為驗證完', async () => {
    const api = fakeImportApi();
    const { result } = await analyzed(api);

    act(() => result.current.edit([{ rowNo: 2, key: 'email', value: '' }]));

    await waitFor(() => expect(result.current.validating).toBe(false), WAIT);
    expect(api.validate).not.toHaveBeenCalled();
  });

  it('以失敗的列重新匯入：開成新的預覽並全部重新驗證', async () => {
    const api = fakeImportApi();
    const { result } = renderWorkspace(api);

    act(() =>
      result.current.loadRows(
        COLUMNS,
        [{ rowNo: 1, sourceRow: 5, cells: { email: 'x@example.com' } }],
        'users.csv',
      ),
    );

    expect(result.current.phase).toBe('preview');
    await waitFor(() => expect(api.validate).toHaveBeenCalled(), WAIT);
  });

  describe('送出套用', () => {
    it('成功：回傳傳輸、刪除草稿、回到上傳步驟', async () => {
      const owner = signIn();
      const api = fakeImportApi();
      const { result } = await analyzed(api);
      await saveImportDraft(owner, 'user', {
        mode: 'create',
        fileName: 'users.csv',
        columns: COLUMNS,
        ignored: [],
        rows: [],
        results: {},
      });

      let transfer: Awaited<ReturnType<typeof result.current.submit>> = null;
      await act(async () => {
        transfer = await result.current.submit(false);
      });

      expect(transfer).toEqual({ id: 'transfer-1' });
      expect(result.current.phase).toBe('setup');
      expect(result.current.state.rows).toEqual([]);
      expect(await loadImportDraft(owner, 'user', 'create')).toBeUndefined();
    });

    it('失敗：回到預覽、保留錯誤，回傳 null', async () => {
      const failure = new Error('conflict');
      const { result } = await analyzed(
        fakeImportApi({ createImport: vi.fn().mockRejectedValue(failure) }),
      );

      let transfer: unknown = 'unset';
      await act(async () => {
        transfer = await result.current.submit(true);
      });

      expect(transfer).toBeNull();
      expect(result.current.phase).toBe('preview');
      expect(result.current.error).toBe(failure);
    });

    it('修改模式：沒有變更的列不送；有變更的列帶上比對到的目標與版本', async () => {
      const api = fakeImportApi({ analyze: vi.fn(async () => updateAnalysis()) });
      const { result } = await analyzed(api, 'update');

      expect(result.current.state.ignored).toEqual(['id']);
      expect(result.current.submittable).toEqual([
        {
          rowNo: 1,
          sourceRow: 2,
          cells: { email: 'new@example.com' },
          target: { id: 'u1', version: 3 },
        },
      ]);
    });

    it('修改模式手動指定比對目標：驗證時帶 targetId', async () => {
      const api = fakeImportApi({ analyze: vi.fn(async () => updateAnalysis()) });
      const { result } = await analyzed(api, 'update');

      act(() => result.current.setTarget(2, { id: 'u9', label: 'other@example.com' }));

      await waitFor(() => expect(api.validate).toHaveBeenCalled(), WAIT);
      expect(api.validate).toHaveBeenCalledWith(
        'user',
        'update',
        [{ rowNo: 2, cells: { email: 'same@example.com' }, targetId: 'u9' }],
        undefined,
      );
    });
  });

  describe('草稿（docs/architecture/frontend/21-data-transfer.md §4.2）', () => {
    it('預覽中的資料存成草稿；下次開啟提示接續，接續後全部重新驗證', async () => {
      const owner = signIn();
      const first = await analyzed(fakeImportApi());
      await waitFor(
        async () => expect(await loadImportDraft(owner, 'user', 'create')).toBeDefined(),
        WAIT,
      );
      first.unmount();

      const api = fakeImportApi();
      const { result } = renderWorkspace(api);
      await waitFor(
        () => expect(result.current.draft).toMatchObject({ fileName: 'users.csv', rows: 2 }),
        WAIT,
      );

      await act(() => result.current.resumeDraft());

      expect(result.current.draft).toBeNull();
      expect(result.current.phase).toBe('preview');
      expect(result.current.state.rows).toHaveLength(2);
      await waitFor(() => expect(api.validate).toHaveBeenCalled(), WAIT);
    });

    it('捨棄草稿：提示消失，草稿刪除', async () => {
      const owner = signIn();
      await saveImportDraft(owner, 'user', {
        mode: 'create',
        fileName: null,
        columns: COLUMNS,
        ignored: [],
        rows: [{ rowNo: 1, sourceRow: null, cells: { email: 'a@example.com' } }],
        results: {},
      });
      const { result } = renderWorkspace(fakeImportApi());
      await waitFor(() => expect(result.current.draft).not.toBeNull(), WAIT);

      await act(() => result.current.discardDraft());

      expect(result.current.draft).toBeNull();
      expect(await loadImportDraft(owner, 'user', 'create')).toBeUndefined();
    });

    it('草稿已經被刪掉時接續不做事', async () => {
      const owner = signIn();
      await saveImportDraft(owner, 'user', {
        mode: 'create',
        fileName: null,
        columns: COLUMNS,
        ignored: [],
        rows: [{ rowNo: 1, sourceRow: null, cells: { email: 'a@example.com' } }],
        results: {},
      });
      const { result } = renderWorkspace(fakeImportApi());
      await waitFor(() => expect(result.current.draft).not.toBeNull(), WAIT);
      // 提示出現之後，草稿在別的分頁被刪掉了
      await removeImportDraft(owner, 'user', 'create');

      await act(() => result.current.resumeDraft());

      expect(result.current.phase).toBe('setup');
      expect(result.current.draft).toBeNull();
    });

    it('放棄預覽：回到上傳步驟並刪除草稿', async () => {
      const owner = signIn();
      const { result } = await analyzed(fakeImportApi());
      await waitFor(
        async () => expect(await loadImportDraft(owner, 'user', 'create')).toBeDefined(),
        WAIT,
      );

      await act(() => result.current.discard());

      expect(result.current.phase).toBe('setup');
      expect(await loadImportDraft(owner, 'user', 'create')).toBeUndefined();
    });

    it('沒有登入的身分時不存、不讀草稿', async () => {
      const { result } = await analyzed(fakeImportApi());

      await act(() => result.current.resumeDraft());
      await act(() => result.current.discardDraft());

      expect(result.current.phase).toBe('preview');
      expect(result.current.draft).toBeNull();
    });
  });

  it('新增、移除列可以復原與重做；重新比對不離開預覽', async () => {
    const { result } = renderWorkspace(fakeImportApi());
    act(() =>
      result.current.startManual([importColumn({ key: 'name', label: '名稱' })], '直接輸入'),
    );
    const before = result.current.state.rows.length;

    act(() => result.current.addRow());
    expect(result.current.state.rows).toHaveLength(before + 1);
    act(() => result.current.removeRows([1]));
    expect(result.current.state.rows).toHaveLength(before);
    act(() => result.current.undo());
    expect(result.current.state.rows).toHaveLength(before + 1);
    act(() => result.current.redo());
    expect(result.current.state.rows).toHaveLength(before);
    act(() => result.current.revalidateAll());
    expect(result.current.phase).toBe('preview');
  });
});
