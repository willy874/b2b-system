import { createDraftStore } from '@b2b-system/web-shared/storage';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { sessionStore } from '../../auth';
import type { ImportAnalysis, ImportApi, ImportMode } from '../../data-transfer';
import { AppError } from '../../errors';
import { setImportDraftStore } from '../../form';
import { findHotkey, isMacPlatform } from '../../hotkey';
import { initTestI18n, renderInRouter } from '../../testing';
import { saveImportDraft } from '../importDraft';
import { ImportWorkspace } from '../ImportWorkspace';
import type { ImportWorkspaceProps } from '../ImportWorkspace';
import { COLUMNS, fakeImportApi, importColumn, signIn, transfer } from './fakeImportApi';

/** 送出前對話框的統計（testid 固定，種類以 data-value 區分、筆數在 data-count）。 */
function submitStat(scope: HTMLElement, key: string): HTMLElement {
  const stat = scope.querySelector<HTMLElement>(
    `[data-testid="import-submit-stat"][data-value="${key}"]`,
  );
  if (!stat) throw new Error(`找不到 import-submit-stat（data-value="${key}"）`);
  return stat;
}

/** 下載範本的按鈕（testid 固定，格式以 data-value 區分）。 */
async function templateButton(format: string): Promise<HTMLElement> {
  const buttons = await screen.findAllByTestId('import-template');
  const button = buttons.find((element) => element.dataset.value === format);
  if (!button) throw new Error(`找不到 import-template（data-value="${format}"）`);
  return button;
}

// jsdom 沒有 ResizeObserver（預覽表格用它量測可視範圍）與 scrollIntoView（結束編輯時捲到儲存格）
Element.prototype.scrollIntoView ??= () => {};
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

const fakeApi = fakeImportApi;

describe('ImportWorkspace（docs/architecture/backend/22-data-transfer.md §7.2）', () => {
  beforeAll(async () => {
    setImportDraftStore(createDraftStore({ indexedDB: undefined }));
    await initTestI18n();
  });
  afterAll(() => setImportDraftStore(undefined));

  it('上傳 → 分析 → 預覽標出錯誤的儲存格 → 勾選略過後套用', async () => {
    const api = fakeApi();
    const onTransferChange = vi.fn();
    renderInRouter(
      <ImportWorkspace
        api={api}
        type="user"
        mode="create"
        modes={['create']}
        onModeChange={vi.fn()}
        transferId={null}
        onTransferChange={onTransferChange}
      />,
    );
    const input = await screen.findByLabelText('選擇檔案', { selector: 'input' });
    await userEvent.upload(
      input,
      new File(['email\na@example.com'], 'users.csv', { type: 'text/csv' }),
    );
    await userEvent.click(screen.getByTestId('import-analyze'));

    expect(await screen.findByTestId('import-preview')).toBeInTheDocument();
    expect(api.analyze).toHaveBeenCalledWith('user', expect.any(File), {
      encoding: 'auto',
      mode: 'create',
    });
    expect(screen.getByText('bad')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('bad')).toHaveAttribute('title', 'Email 格式不正確');
    expect(screen.getByTestId('import-summary')).toHaveTextContent('共 2 列：1 列錯誤');

    await userEvent.click(screen.getByTestId('import-submit'));
    expect(screen.getByTestId('import-submit-confirm')).toBeDisabled();
    // 確認對話框：要新增幾列、幾列有錯誤（有錯誤的列不算在新增裡）
    expect(submitStat(document.body, 'create')).toHaveAttribute('data-count', '1');
    expect(submitStat(document.body, 'errors')).toHaveAttribute('data-count', '1');
    await userEvent.click(screen.getByRole('checkbox', { name: /略過有錯誤的列/ }));
    await userEvent.click(screen.getByTestId('import-submit-confirm'));
    await waitFor(() => expect(onTransferChange).toHaveBeenCalledWith('transfer-1'));
    expect(api.createImport).toHaveBeenCalledWith({
      type: 'user',
      mode: 'create',
      fileName: 'users.csv',
      skipInvalid: true,
      rows: [
        { rowNo: 1, sourceRow: 2, cells: { email: 'a@example.com' } },
        { rowNo: 2, sourceRow: 3, cells: { email: 'bad' } },
      ],
    });
  });

  it('復原／重做的快捷鍵：焦點不在表格時也可以用；離開預覽後取消登記', async () => {
    const api = fakeApi();
    const view = renderInRouter(
      <ImportWorkspace
        api={api}
        type="user"
        mode="create"
        modes={['create']}
        onModeChange={vi.fn()}
        transferId={null}
        onTransferChange={vi.fn()}
      />,
    );
    const input = await screen.findByLabelText('選擇檔案', { selector: 'input' });
    await userEvent.upload(input, new File(['email'], 'users.csv', { type: 'text/csv' }));
    await userEvent.click(screen.getByTestId('import-analyze'));
    await screen.findByTestId('import-preview');
    await userEvent.click(screen.getByTestId('import-add-row'));
    expect(screen.getAllByTestId('import-row-status')).toHaveLength(3);

    const mac = isMacPlatform();
    const press = (shift = false) => {
      const event = new KeyboardEvent('keydown', {
        key: 'z',
        ctrlKey: !mac,
        metaKey: mac,
        shiftKey: shift,
      });
      const hotkey = findHotkey(event);
      expect(hotkey).toBeDefined();
      act(() => hotkey?.run(event));
    };
    press();
    expect(screen.getAllByTestId('import-row-status')).toHaveLength(2);
    press(true);
    expect(screen.getAllByTestId('import-row-status')).toHaveLength(3);

    view.unmount();
    expect(
      findHotkey(new KeyboardEvent('keydown', { key: 'z', ctrlKey: !mac, metaKey: mac })),
    ).toBeUndefined();
  });
});

function renderWorkspace(props: Partial<ImportWorkspaceProps> = {}) {
  const onModeChange = vi.fn();
  const onTransferChange = vi.fn();
  const api = props.api ?? fakeImportApi();
  const view = renderInRouter(
    <ImportWorkspace
      api={api}
      type="user"
      mode="create"
      modes={['create']}
      onModeChange={onModeChange}
      transferId={null}
      onTransferChange={onTransferChange}
      {...props}
    />,
  );
  return { api, onModeChange, onTransferChange, ...view };
}

async function uploadAndAnalyze(name = 'users.csv') {
  const input = await screen.findByLabelText('選擇檔案', { selector: 'input' });
  await userEvent.upload(input, new File(['email'], name, { type: 'text/csv' }));
  await userEvent.click(screen.getByTestId('import-analyze'));
}

const rowStatuses = () =>
  screen.getAllByTestId('import-row-status').map((status) => status.dataset.value);

function analysis(
  overrides: Partial<Extract<ImportAnalysis, { status: 'ok' }>> = {},
): ImportAnalysis {
  return {
    status: 'ok',
    fileName: 'users.csv',
    columns: COLUMNS,
    ignored: [],
    rows: [{ rowNo: 1, sourceRow: 2, cells: { email: 'a@example.com' } }],
    results: [{ rowNo: 1, issues: [] }],
    ...overrides,
  };
}

describe('ImportWorkspace（上傳與分析）', () => {
  beforeAll(async () => {
    await initTestI18n();
  });
  beforeEach(() => setImportDraftStore(createDraftStore({ indexedDB: undefined })));
  afterEach(() => {
    setImportDraftStore(undefined);
    sessionStore.clear();
    vi.restoreAllMocks();
  });

  it('有兩種模式的權限時可以切換，交給 onModeChange', async () => {
    const { onModeChange } = renderWorkspace({ modes: ['create', 'update'] });
    const modes = await screen.findByTestId('import-mode');
    expect(modes).toHaveTextContent('每一列建立一筆新資料');

    await userEvent.click(within(modes).getByRole('radio', { name: /修改/ }));

    expect(onModeChange).toHaveBeenCalledWith('update');
  });

  it('只有一種模式時不顯示切換', async () => {
    renderWorkspace();
    await screen.findByTestId('import-workspace');
    expect(screen.queryByTestId('import-mode')).not.toBeInTheDocument();
  });

  it('欄位說明：必填、格式、選項、比對鍵與說明；修改模式註明可以清空', async () => {
    const columns = [
      importColumn({ matchKey: 1, hint: '登入用的 Email' }),
      importColumn({
        key: 'status',
        label: '狀態',
        kind: 'enum',
        required: false,
        unique: false,
        nullable: true,
        multiple: true,
        options: [
          { value: 'active', label: '啟用' },
          { value: 'disabled', label: '停用' },
        ],
      }),
    ];
    renderWorkspace({
      mode: 'update',
      api: fakeImportApi({ fetchColumns: async () => ({ items: columns, readOnly: [] }) }),
    });
    const guide = await screen.findByTestId('import-guide');
    await waitFor(() => expect(within(guide).getAllByRole('row')).toHaveLength(3));
    const [, email, status] = within(guide).getAllByRole('row');

    expect(email).toHaveTextContent('Email比對鍵');
    expect(email).toHaveTextContent('是');
    expect(email).toHaveTextContent('登入用的 Email');
    expect(status).toHaveTextContent('選項');
    expect(status).toHaveTextContent('啟用、停用');
    expect(status).toHaveTextContent('多個值以 ; 分隔');
    expect(status).toHaveTextContent('填 \\N 清空');
  });

  it('下載範本：經 API 取得檔案再存檔；失敗時提示', async () => {
    const original = { createObjectURL: URL.createObjectURL, revokeObjectURL: URL.revokeObjectURL };
    Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:template'), revokeObjectURL: vi.fn() });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    const downloadTemplate = vi
      .fn<ImportApi['downloadTemplate']>()
      .mockResolvedValueOnce({ blob: new Blob(['email']), fileName: 'user-template.csv' })
      .mockRejectedValueOnce(new AppError('DATA_TRANSFER_TYPE_UNSUPPORTED', 400));
    try {
      renderWorkspace({ api: fakeImportApi({ downloadTemplate }) });

      await userEvent.click(await templateButton('csv'));
      await waitFor(() => expect(click).toHaveBeenCalled());
      expect(downloadTemplate).toHaveBeenCalledWith('user', 'create', 'csv');

      await userEvent.click(await templateButton('xlsx'));
      expect(await screen.findByText('這種資料不支援這個匯入或匯出方式。')).toBeInTheDocument();
    } finally {
      Object.assign(URL, original);
    }
  });

  it('分析失敗時留在上傳步驟並顯示錯誤', async () => {
    renderWorkspace({
      api: fakeImportApi({
        analyze: vi.fn().mockRejectedValue(new AppError('DATA_TRANSFER_TYPE_UNSUPPORTED', 400)),
      }),
    });
    await uploadAndAnalyze();

    expect(await screen.findByText('這種資料不支援這個匯入或匯出方式。')).toBeInTheDocument();
    expect(screen.getByTestId('import-workspace')).toHaveAttribute('data-value', 'setup');
  });

  it('不上傳，直接輸入：開出空白的預覽', async () => {
    renderWorkspace();
    const manual = await screen.findByTestId('import-manual');
    await waitFor(() => expect(manual).toBeEnabled());

    await userEvent.click(manual);

    expect(await screen.findByTestId('import-preview')).toBeInTheDocument();
    expect(screen.getByTestId('import-summary')).toHaveTextContent('共 0 列');
    expect(new Set(rowStatuses())).toEqual(new Set(['blank']));
    expect(screen.getByTestId('import-submit')).toBeDisabled();
  });

  it('分析回報多個工作表時可以改選；放棄預覽後以選的工作表再分析', async () => {
    const analyze = vi.fn(async () => analysis({ sheets: ['名單', '備份'] }));
    renderWorkspace({ api: fakeImportApi({ analyze }) });
    await uploadAndAnalyze();
    await screen.findByTestId('import-preview');

    await userEvent.click(screen.getByTestId('import-discard'));
    await userEvent.click(await screen.findByRole('combobox', { name: '工作表' }));
    await userEvent.click(await screen.findByRole('option', { name: '備份' }));
    await uploadAndAnalyze();

    await waitFor(() => expect(analyze).toHaveBeenCalledTimes(2));
    expect(analyze).toHaveBeenLastCalledWith('user', expect.any(File), {
      encoding: 'auto',
      sheet: '備份',
      mode: 'create',
    });
  });

  describe('對應欄位（ImportMapping）', () => {
    const needsMapping: ImportAnalysis = {
      status: 'needsMapping',
      fileName: 'users.csv',
      headers: [
        { index: 0, text: '電子郵件', suggestion: 'email' },
        { index: 1, text: '備註', suggestion: null },
        { index: 2, text: 'ID', suggestion: null },
        { index: 3, text: '密碼', suggestion: null },
      ],
      samples: [
        ['a@example.com', '新進', '1', ''],
        ['b@example.com', '', '2', ''],
      ],
      ignored: [
        { index: 2, header: 'ID', reason: 'readOnly' },
        { index: 3, header: '密碼', reason: 'forbidden' },
      ],
      columns: COLUMNS,
    };

    it('列出標頭與樣本；唯讀與沒有權限的欄位註明原因；確認後以 mapping 再分析', async () => {
      const analyze = vi
        .fn<ImportApi['analyze']>()
        .mockResolvedValueOnce(needsMapping)
        .mockResolvedValue(analysis());
      renderWorkspace({ api: fakeImportApi({ analyze }) });
      await uploadAndAnalyze();

      const mapping = await screen.findByTestId('import-mapping');
      const rows = within(mapping).getAllByRole('row');
      expect(rows[1]).toHaveTextContent('a@example.com、b@example.com');
      expect(rows[3]).toHaveTextContent('唯讀欄位');
      expect(rows[4]).toHaveTextContent('沒有權限');
      expect(within(mapping).getAllByTestId('import-mapping-select')).toHaveLength(2);

      await userEvent.click(within(mapping).getByRole('combobox', { name: '電子郵件' }));
      await userEvent.click(await screen.findByRole('option', { name: '忽略' }));
      await userEvent.click(within(mapping).getByRole('combobox', { name: '備註' }));
      await userEvent.click(await screen.findByRole('option', { name: 'Email' }));
      await userEvent.click(screen.getByTestId('import-mapping-confirm'));

      expect(await screen.findByTestId('import-preview')).toBeInTheDocument();
      expect(analyze).toHaveBeenLastCalledWith('user', expect.any(File), {
        encoding: 'auto',
        mode: 'create',
        mapping: { 0: null, 1: 'email', 2: null, 3: null },
      });
    });

    it('取消對應回到上傳步驟', async () => {
      renderWorkspace({ api: fakeImportApi({ analyze: vi.fn(async () => needsMapping) }) });
      await uploadAndAnalyze();
      const mapping = await screen.findByTestId('import-mapping');

      await userEvent.click(within(mapping).getByRole('button', { name: '取消' }));

      expect(screen.queryByTestId('import-mapping')).not.toBeInTheDocument();
      expect(screen.getByTestId('import-workspace')).toHaveAttribute('data-value', 'setup');
    });
  });

  it('有未完成的草稿時提示接續；接續後回到預覽', async () => {
    const owner = signIn();
    await saveImportDraft(owner, 'user', {
      mode: 'create',
      fileName: 'old.csv',
      columns: COLUMNS,
      ignored: [],
      rows: [{ rowNo: 1, sourceRow: 2, cells: { email: 'a@example.com' } }],
      results: { 1: { rowNo: 1, issues: [] } },
    });
    renderWorkspace();

    const draft = await screen.findByTestId('import-draft');
    expect(draft).toHaveTextContent('old.csv（1 列');
    await userEvent.click(screen.getByTestId('import-draft-resume'));

    expect(await screen.findByTestId('import-preview')).toBeInTheDocument();
    expect(screen.queryByTestId('import-draft')).not.toBeInTheDocument();
  });

  it('捨棄草稿後提示消失', async () => {
    const owner = signIn();
    await saveImportDraft(owner, 'user', {
      mode: 'create',
      fileName: null,
      columns: COLUMNS,
      ignored: [],
      rows: [{ rowNo: 1, sourceRow: null, cells: { email: 'a@example.com' } }],
      results: {},
    });
    renderWorkspace();
    const draft = await screen.findByTestId('import-draft');
    expect(draft).toHaveTextContent('直接輸入（1 列');

    await userEvent.click(within(draft).getByRole('button', { name: '捨棄' }));

    await waitFor(() => expect(screen.queryByTestId('import-draft')).not.toBeInTheDocument());
  });
});

describe('ImportWorkspace（預覽與修正）', () => {
  beforeAll(async () => {
    await initTestI18n();
  });
  beforeEach(() => setImportDraftStore(createDraftStore({ indexedDB: undefined })));
  afterEach(() => {
    setImportDraftStore(undefined);
    vi.restoreAllMocks();
  });

  it('篩選「錯誤」只顯示有錯誤的列', async () => {
    renderWorkspace();
    await uploadAndAnalyze();
    await screen.findByTestId('import-preview');
    expect(rowStatuses()).toEqual(['ok', 'error']);

    await userEvent.click(screen.getByRole('tab', { name: '錯誤 1' }));

    expect(rowStatuses()).toEqual(['error']);
  });

  it('勾選列後從匯入中移除', async () => {
    renderWorkspace();
    await uploadAndAnalyze();
    await screen.findByTestId('import-preview');
    expect(screen.getByTestId('import-remove-rows')).toBeDisabled();

    const grid = screen.getByTestId('import-grid');
    fireEvent.click(within(grid).getAllByRole('checkbox')[2]!);
    await userEvent.click(screen.getByTestId('import-remove-rows'));

    expect(rowStatuses()).toEqual(['ok']);
    expect(screen.getByTestId('import-summary')).toHaveTextContent('共 1 列：0 列錯誤');
  });

  it('修改模式：比對目標欄、變更計數、不會匯入的欄位；可以重新比對', async () => {
    const target = (id: string, email: string) => ({
      id,
      label: email,
      version: 1,
      current: { email },
    });
    const api = fakeImportApi({
      analyze: vi.fn(async () =>
        analysis({
          ignored: [{ header: 'id', reason: 'readOnly' }],
          rows: [
            { rowNo: 1, sourceRow: 2, cells: { email: 'new@example.com' } },
            { rowNo: 2, sourceRow: 3, cells: { email: 'same@example.com' } },
            { rowNo: 3, sourceRow: 4, cells: { email: 'who@example.com' } },
          ],
          results: [
            { rowNo: 1, issues: [], target: target('u1', 'old@example.com'), changed: ['email'] },
            { rowNo: 2, issues: [], target: target('u2', 'same@example.com'), changed: [] },
            {
              rowNo: 3,
              issues: [{ column: null, code: 'targetNotFound', severity: 'error' }],
            },
          ],
        }),
      ),
    });
    renderWorkspace({ api, mode: 'update', modes: ['update'] });
    await uploadAndAnalyze();
    await screen.findByTestId('import-preview');

    expect(screen.getByTestId('import-summary')).toHaveTextContent(
      '共 3 列：1 列錯誤、0 列警告 1 列有變更、1 列無變更 以下欄位不會匯入：id',
    );
    expect(screen.getByRole('tab', { name: '有變更 1' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '無變更 1' })).toBeInTheDocument();
    // 比對目標欄（修改模式的第一個資料欄）：比對到的名稱；比對不到的標出問題
    expect(screen.getByText('old@example.com')).toBeInTheDocument();
    const unmatched = screen.getAllByText('未比對').at(-1)!;
    expect(unmatched.closest('[title]')).toHaveAttribute('title', '找不到這筆資料');

    await userEvent.click(screen.getByTestId('import-submit'));
    const dialog = await screen.findByTestId('import-submit-dialog');
    expect(submitStat(dialog, 'update')).toHaveAttribute('data-count', '1');
    expect(submitStat(dialog, 'unchanged')).toHaveAttribute('data-count', '1');
    await userEvent.click(within(dialog).getByRole('button', { name: '取消' }));

    await userEvent.click(screen.getByTestId('import-revalidate'));
    await waitFor(() => expect(api.validate).toHaveBeenCalled(), { timeout: 5000 });
  });

  /** 選取一格並進入編輯（jsdom 沒有寬度：表格只渲染第一個資料欄）。 */
  function editCell(text: string) {
    const cell = screen.getAllByText(text)[0]!.closest('[role="gridcell"]') as HTMLElement;
    fireEvent.mouseDown(cell);
    fireEvent.click(cell);
    fireEvent.doubleClick(cell);
  }

  it('修改模式手動指定比對目標：從搜尋結果選一筆，再撤回比對', async () => {
    const searchTargets = vi.fn(async () => [
      { id: 'u9', label: 'other@example.com', description: '業務部' },
    ]);
    const api = fakeImportApi({
      searchTargets,
      analyze: vi.fn(async () =>
        analysis({
          rows: [{ rowNo: 1, sourceRow: 2, cells: { email: 'who@example.com' } }],
          results: [
            { rowNo: 1, issues: [{ column: null, code: 'targetNotFound', severity: 'error' }] },
          ],
        }),
      ),
    });
    renderWorkspace({ api, mode: 'update', modes: ['update'] });
    await uploadAndAnalyze();
    await screen.findByTestId('import-preview');

    editCell('未比對');
    expect(await screen.findByRole('option', { name: /自動比對/ })).toBeInTheDocument();
    await userEvent.click(await screen.findByRole('option', { name: /other@example\.com/ }));

    expect(await screen.findByTestId('import-target-manual')).toHaveTextContent(
      'other@example.com手動指定',
    );
    expect(searchTargets).toHaveBeenCalledWith('user', '');
    await waitFor(
      () =>
        expect(api.validate).toHaveBeenCalledWith(
          'user',
          'update',
          [{ rowNo: 1, cells: { email: 'who@example.com' }, targetId: 'u9' }],
          undefined,
        ),
      { timeout: 5000 },
    );

    editCell('other@example.com');
    await userEvent.click(await screen.findByRole('option', { name: /撤回比對/ }));

    await waitFor(() =>
      expect(screen.queryByTestId('import-target-manual')).not.toBeInTheDocument(),
    );
  });

  it('名稱（reference）欄的編輯器向伺服器查詢選項', async () => {
    const searchOptions = vi.fn(async () => [{ id: 'r1', label: '稽核人員' }]);
    const roles = importColumn({
      key: 'roles',
      label: '角色',
      kind: 'reference',
      unique: false,
      multiple: true,
    });
    renderWorkspace({
      api: fakeImportApi({
        searchOptions,
        analyze: vi.fn(async () =>
          analysis({
            columns: [roles],
            rows: [{ rowNo: 1, sourceRow: 2, cells: { roles: '一般成員' } }],
          }),
        ),
      }),
    });
    await uploadAndAnalyze();
    await screen.findByTestId('import-preview');

    editCell('一般成員');

    expect(await screen.findByRole('option', { name: '稽核人員' })).toBeInTheDocument();
    expect(searchOptions).toHaveBeenCalledWith('user', 'roles', '');
  });

  it('選項（enum）欄的編輯器列出選項的名稱', async () => {
    const status = importColumn({
      key: 'status',
      label: '狀態',
      kind: 'enum',
      unique: false,
      options: [
        { value: 'active', label: '啟用' },
        { value: 'disabled', label: '停用' },
      ],
    });
    renderWorkspace({
      api: fakeImportApi({
        analyze: vi.fn(async () =>
          analysis({
            columns: [status],
            rows: [{ rowNo: 1, sourceRow: 2, cells: { status: '啟用' } }],
          }),
        ),
      }),
    });
    await uploadAndAnalyze();
    await screen.findByTestId('import-preview');

    editCell('啟用');

    expect(await screen.findByRole('option', { name: '停用' })).toBeInTheDocument();
  });

  it('非唯一的文字欄：建議同一欄填過的值', async () => {
    const name = importColumn({ key: 'name', label: '名稱', unique: false, required: false });
    renderWorkspace({
      api: fakeImportApi({
        analyze: vi.fn(async () =>
          analysis({
            columns: [name],
            rows: [
              { rowNo: 1, sourceRow: 2, cells: { name: '業務部' } },
              { rowNo: 2, sourceRow: 3, cells: { name: '業務二部' } },
            ],
          }),
        ),
      }),
    });
    await uploadAndAnalyze();
    await screen.findByTestId('import-preview');

    editCell('業務部');
    fireEvent.change(screen.getByRole('combobox', { name: '名稱' }), { target: { value: '業務' } });

    expect(await screen.findByRole('option', { name: '業務二部' })).toBeInTheDocument();
  });

  it('\\N（清空）顯示成「清空」標籤', async () => {
    renderWorkspace({
      api: fakeImportApi({
        analyze: vi.fn(async () =>
          analysis({ rows: [{ rowNo: 1, sourceRow: 2, cells: { email: '\\N' } }] }),
        ),
      }),
    });
    await uploadAndAnalyze();
    await screen.findByTestId('import-preview');

    expect(screen.getByText('清空')).toBeInTheDocument();
  });

  it('Email 欄的自動完成：輸入 `名字@` 時補完同一欄出現過的網域', async () => {
    renderWorkspace();
    await uploadAndAnalyze();
    await screen.findByTestId('import-preview');

    const cell = screen.getByText('bad').closest('[role="gridcell"]') as HTMLElement;
    fireEvent.mouseDown(cell);
    fireEvent.click(cell);
    fireEvent.doubleClick(cell);
    const input = screen.getByRole('combobox', { name: 'Email' });
    fireEvent.change(input, { target: { value: 'carol@' } });

    expect(await screen.findByRole('option', { name: 'carol@example.com' })).toBeInTheDocument();
  });

  it('套用失敗時留在預覽並顯示錯誤，不切到結果', async () => {
    const { onTransferChange } = renderWorkspace({
      api: fakeImportApi({
        analyze: vi.fn(async () => analysis()),
        createImport: vi.fn().mockRejectedValue(new AppError('DATA_TRANSFER_INVALID_STATE', 409)),
      }),
    });
    await uploadAndAnalyze();
    await screen.findByTestId('import-preview');

    await userEvent.click(screen.getByTestId('import-submit'));
    await userEvent.click(await screen.findByTestId('import-submit-confirm'));

    expect(
      await screen.findByText('這筆匯入或匯出目前的狀態無法進行這個操作，請重新整理後再試。'),
    ).toBeInTheDocument();
    expect(onTransferChange).not.toHaveBeenCalled();
  });
});

describe('ImportWorkspace（已送出的傳輸）', () => {
  beforeAll(async () => {
    await initTestI18n();
  });

  it('網址帶著傳輸時顯示結果；「再匯入一份」清掉傳輸', async () => {
    const { onTransferChange } = renderWorkspace({
      transferId: 'transfer-1',
      api: fakeImportApi({
        fetchTransfer: async () =>
          transfer({ id: 'transfer-1', direction: 'import', status: 'completed' }),
      }),
    });

    await userEvent.click(await screen.findByTestId('import-new'));

    expect(onTransferChange).toHaveBeenCalledWith(null);
  });

  it('以失敗的列重新匯入：清掉傳輸，回到預覽', async () => {
    const mode: ImportMode = 'create';
    const { onTransferChange } = renderWorkspace({
      mode,
      transferId: 'transfer-1',
      api: fakeImportApi({
        fetchTransfer: async () =>
          transfer({
            id: 'transfer-1',
            direction: 'import',
            mode,
            status: 'completed',
            failedRows: 1,
          }),
        fetchRows: async (_id, query) => ({
          items: query.outcome
            ? [
                {
                  rowNo: 1,
                  sourceRow: 2,
                  cells: { email: 'x@example.com' },
                  outcome: 'failed' as const,
                  error: null,
                  changes: null,
                  resultId: null,
                },
              ]
            : [],
          nextRowNo: null,
        }),
      }),
    });

    await userEvent.click(await screen.findByTestId('import-retry-failed'));

    await waitFor(() => expect(onTransferChange).toHaveBeenCalledWith(null));
  });
});
