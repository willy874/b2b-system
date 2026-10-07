import type { TableColumnDef } from '@b2b-system/ui/Table';
import { useTableSelection } from '@b2b-system/ui/Table';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  BatchQueueNotifier,
  registerBatchOperation,
  resetBatchOperations,
  setActiveBatchQueue,
} from '../../batch';
import type { BatchAction, BatchPageFetcher, QueuedBatchAction } from '../../batch';
import { AppError } from '../../errors';
import { useTableColumnSettingsStore } from '../../store';
import { createFakeBatchQueue } from '../../testing/fakeBatchQueue';
import { AllProviders } from '../../testing/renderWithPermissions';
import { RichTable } from './RichTable';

interface Row {
  id: string;
  name: string;
  locked: boolean;
}

const ROWS: Row[] = [
  { id: 'a', name: 'Alice', locked: true },
  { id: 'b', name: 'Bob', locked: false },
  { id: 'c', name: 'Carol', locked: true },
];
const getId = (row: Row) => row.id;
const columns: Array<TableColumnDef<Row>> = [
  { id: 'name', header: 'Name', cell: ({ row }) => row.original.name },
];

function action(overrides: Partial<QueuedBatchAction<Row>> = {}): QueuedBatchAction<Row> {
  return {
    id: 'unlock',
    label: 'Unlock',
    isEligible: (row) => row.locked,
    confirm: ({ eligible }) => ({ title: 'Unlock?', description: `${eligible.length} rows` }),
    operation: 'row.unlock',
    ...overrides,
  };
}

function Harness({
  actions,
  getRowVersion,
  selectAllMatching,
}: {
  actions: Array<BatchAction<Row>>;
  getRowVersion?: (row: Row) => number;
  selectAllMatching?: { total: number; fetchPage: BatchPageFetcher<Row> };
}) {
  const selection = useTableSelection(ROWS, getId);
  return (
    <>
      <RichTable
        data={ROWS}
        columns={columns}
        getRowId={getId}
        batch={{
          scope: 'rows',
          selection,
          actions,
          getRowLabel: (row) => row.name,
          getRowVersion,
          selectAllMatching,
        }}
      />
      <output data-testid="selected">{selection.selectedIds.join(',')}</output>
      <BatchQueueNotifier />
    </>
  );
}

/** 每筆呼叫一次；預設全部成功。 */
let runItem = vi.fn(async (_id: string): Promise<unknown> => undefined);
let queue: ReturnType<typeof createFakeBatchQueue>;

function renderHarness(actions: Array<BatchAction<Row>>) {
  return render(<Harness actions={actions} />, { wrapper: AllProviders });
}

async function selectRows(...indexes: number[]) {
  const boxes = screen.getAllByTestId('table-select-row');
  for (const index of indexes) {
    // oxlint-disable-next-line no-await-in-loop -- 點擊要依序發生
    await userEvent.click(boxes[index] as HTMLElement);
  }
}

async function confirmBatch() {
  const dialog = await screen.findByRole('alertdialog');
  await userEvent.click(within(dialog).getByTestId('alert-dialog-confirm'));
}

describe('RichTable 的批次操作（docs/architecture/frontend/07-ui-system.md §13）', () => {
  beforeEach(async () => {
    localStorage.clear();
    useTableColumnSettingsStore.setState({ settings: {}, pinnedRows: {}, pinnedRowData: {} });
    resetBatchOperations();
    runItem = vi.fn(async (_id: string): Promise<unknown> => undefined);
    registerBatchOperation({
      id: 'row.unlock',
      labelKey: 'row.unlock',
      successKey: 'row.unlocked',
      run: (id) => runItem(id),
    });
    queue = createFakeBatchQueue();
    const tab = queue.openTab('this-tab');
    await tab.start();
    setActiveBatchQueue(tab);
  });

  afterEach(() => {
    setActiveBatchQueue(undefined);
    queue.dispose();
  });

  it('不入佇列的動作（kind: run）直接交給呼叫端，不出確認框、不入列（docs/architecture/backend/22-data-transfer.md §8.2）', async () => {
    const run = vi.fn();
    renderHarness([{ kind: 'run', id: 'export', label: 'Export', run }]);
    await selectRows(0, 1);
    await userEvent.click(screen.getByRole('button', { name: 'Export' }));
    expect(run).toHaveBeenCalledWith({ rows: [ROWS[0], ROWS[1]], allMatching: false });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(runItem).not.toHaveBeenCalled();
  });

  it('沒有勾選時不顯示操作列；勾選後顯示筆數與動作', async () => {
    renderHarness([action()]);
    expect(screen.queryByTestId('batch-action-bar')).not.toBeInTheDocument();

    await selectRows(0, 1);
    expect(screen.getByTestId('batch-action-bar-count')).toHaveAttribute('data-value', '2');
    expect(screen.getByTestId('batch-action')).toHaveAttribute('data-value', 'unlock');
  });

  it('按鈕顏色依 tone：省略時 secondary', async () => {
    renderHarness([
      action({ id: 'plain' }),
      action({ id: 'primary', tone: 'primary' }),
      action({ id: 'success', tone: 'success' }),
      action({ id: 'warning', tone: 'warning' }),
      action({ id: 'danger', tone: 'danger' }),
    ]);
    await selectRows(0);
    const variants = screen
      .getAllByTestId('batch-action')
      .map((button) => [button.getAttribute('data-value'), button.getAttribute('data-variant')]);
    expect(variants).toEqual([
      ['plain', 'secondary'],
      ['primary', 'primary'],
      ['success', 'success'],
      ['warning', 'warning'],
      ['danger', 'danger'],
    ]);
  });

  it('hidden 的動作不顯示；全部都 hidden 時整個操作列不出現', async () => {
    renderHarness([action({ hidden: true })]);
    await selectRows(0);
    expect(screen.queryByTestId('batch-action-bar')).not.toBeInTheDocument();
  });

  it('選到的列都不適用 → 按鈕停用，hover 顯示該動作的原因', async () => {
    renderHarness([action({ ineligibleReason: '只能解鎖被鎖定的列' })]);
    await selectRows(1);
    const button = screen.getByTestId('batch-action');
    expect(button).toHaveAttribute('aria-disabled', 'true');

    await userEvent.hover(button);
    expect(await screen.findByText('只能解鎖被鎖定的列')).toBeVisible();
  });

  it('有 getRowVersion 時每一筆帶著該列的版本執行（樂觀鎖，docs/architecture/backend/14-revisions.md §9.2 D4）', async () => {
    const touched = vi.fn(async (_id: string, _version: number | undefined) => undefined);
    registerBatchOperation({
      id: 'row.touch',
      labelKey: 'row.touch',
      successKey: 'row.touched',
      run: (id, { version }) => touched(id, version),
    });
    const versions: Record<string, number> = { a: 3, c: 7 };
    render(
      <Harness
        actions={[action({ operation: 'row.touch' })]}
        getRowVersion={(row) => versions[row.id] ?? 1}
      />,
      { wrapper: AllProviders },
    );
    await selectRows(0, 2);
    await userEvent.click(screen.getByTestId('batch-action'));
    await confirmBatch();

    await waitFor(() => expect(touched).toHaveBeenCalledTimes(2));
    expect(touched).toHaveBeenCalledWith('a', 3);
    expect(touched).toHaveBeenCalledWith('c', 7);
  });

  it('只把適用的列送進佇列，逐筆呼叫', async () => {
    renderHarness([action()]);
    await selectRows(0, 1, 2);
    await userEvent.click(screen.getByTestId('batch-action'));

    expect(await screen.findByRole('alertdialog')).toHaveTextContent('2 rows');
    await confirmBatch();

    await waitFor(() => expect(runItem.mock.calls.map(([id]) => id)).toEqual(['a', 'c']));
  });

  it('處理中 → 操作列換成進度條，顯示已處理筆數', async () => {
    let finishFirst!: () => void;
    runItem = vi.fn(
      (id: string) =>
        new Promise<unknown>((resolve) => {
          if (id === 'a') finishFirst = () => resolve(undefined);
        }),
    );
    renderHarness([action()]);
    await selectRows(0, 2);
    await userEvent.click(screen.getByTestId('batch-action'));
    await confirmBatch();

    const bar = await screen.findByTestId('batch-progress-bar');
    expect(screen.queryByTestId('batch-action-bar')).not.toBeInTheDocument();
    expect(within(bar).getByTestId('batch-progress-count')).toHaveAttribute('data-value', '0');

    finishFirst();
    await waitFor(() =>
      expect(within(bar).getByTestId('batch-progress-count')).toHaveAttribute('data-value', '1'),
    );
  });

  it('全部成功 → 成功的移出選取、彈出成功提示；略過的仍保持勾選', async () => {
    renderHarness([action()]);
    await selectRows(0, 1);
    await userEvent.click(screen.getByTestId('batch-action'));
    await confirmBatch();

    await waitFor(() => expect(screen.getByTestId('selected')).toHaveTextContent(/^b$/));
    expect(await screen.findByTestId('toast')).toHaveAttribute('data-type', 'success');
    expect(screen.queryByTestId('batch-result-dialog')).not.toBeInTheDocument();
    expect(screen.queryByTestId('batch-progress-bar')).not.toBeInTheDocument();
  });

  it('有失敗 → 結束時彈出結果對話框；失敗的保留勾選，已不存在的移出', async () => {
    runItem = vi.fn(async (id: string) => {
      throw new AppError(id === 'a' ? 'AUTHZ_SELF_MODIFY' : 'USER_NOT_FOUND', 409);
    });
    renderHarness([action()]);
    await selectRows(0, 2);
    await userEvent.click(screen.getByTestId('batch-action'));
    await confirmBatch();

    const dialog = await screen.findByTestId('batch-result-dialog');
    const failures = within(dialog).getAllByTestId('batch-result-failure');
    expect(failures.map((item) => item.getAttribute('data-value'))).toEqual(['a', 'c']);
    expect(failures[0]).toHaveTextContent('Alice');
    expect(screen.getByTestId('selected')).toHaveTextContent(/^a$/);
  });

  it('取消確認 → 不送進佇列、選取不變', async () => {
    renderHarness([action()]);
    await selectRows(0);
    await userEvent.click(screen.getByTestId('batch-action'));
    const dialog = await screen.findByRole('alertdialog');
    await userEvent.click(within(dialog).getByTestId('alert-dialog-cancel'));

    expect(runItem).not.toHaveBeenCalled();
    expect(screen.getByTestId('selected')).toHaveTextContent(/^a$/);
  });

  it('佇列沒有啟用 → 不顯示批次操作', async () => {
    setActiveBatchQueue(undefined);
    renderHarness([action()]);
    await selectRows(0);
    expect(screen.queryByTestId('batch-action-bar')).not.toBeInTheDocument();
  });
});

describe('選取全部符合的 N 筆（docs/architecture/frontend/07-ui-system.md §13.7）', () => {
  /** 篩選結果共 5 筆：本頁是前 3 筆。 */
  const MATCHING: Row[] = [
    ...ROWS,
    { id: 'd', name: 'Dave', locked: true },
    { id: 'e', name: 'Eve', locked: false },
  ];
  const fetchPage = vi.fn<BatchPageFetcher<Row>>(async (offset, limit) => ({
    items: MATCHING.slice(offset, offset + limit),
    total: MATCHING.length,
  }));

  beforeEach(async () => {
    resetBatchOperations();
    runItem = vi.fn(async (_id: string): Promise<unknown> => undefined);
    fetchPage.mockClear();
    registerBatchOperation({
      id: 'row.unlock',
      labelKey: 'row.unlock',
      successKey: 'row.unlocked',
      run: (id) => runItem(id),
    });
    queue = createFakeBatchQueue();
    const tab = queue.openTab('this-tab');
    await tab.start();
    setActiveBatchQueue(tab);
  });

  afterEach(() => {
    setActiveBatchQueue(undefined);
    queue.dispose();
  });

  function renderWithTotal(total: number, fetcher: BatchPageFetcher<Row> = fetchPage) {
    return render(
      <Harness actions={[action()]} selectAllMatching={{ total, fetchPage: fetcher }} />,
      {
        wrapper: AllProviders,
      },
    );
  }

  it('整頁勾選後才提供；選取後筆數是總數，執行時逐頁收集、只送適用的', async () => {
    renderWithTotal(MATCHING.length);
    await selectRows(0, 1);
    expect(screen.queryByTestId('batch-select-all-matching')).not.toBeInTheDocument();

    await selectRows(2);
    await userEvent.click(screen.getByTestId('batch-select-all-matching'));
    expect(screen.getByTestId('batch-action-bar-count')).toHaveAttribute('data-value', '5');
    expect(screen.getByTestId('batch-all-matching')).toBeInTheDocument();
    expect(fetchPage).not.toHaveBeenCalled();

    await userEvent.click(screen.getByTestId('batch-action'));
    expect(await screen.findByRole('alertdialog')).toHaveTextContent('3 rows');
    await confirmBatch();

    await waitFor(() => expect(runItem.mock.calls.map(([id]) => id)).toEqual(['a', 'c', 'd']));
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it('取消勾選任一列 → 回到明確選取', async () => {
    renderWithTotal(MATCHING.length);
    await selectRows(0, 1, 2);
    await userEvent.click(screen.getByTestId('batch-select-all-matching'));
    await selectRows(1);

    expect(screen.queryByTestId('batch-all-matching')).not.toBeInTheDocument();
    expect(screen.getByTestId('batch-action-bar-count')).toHaveAttribute('data-value', '2');
  });

  it('總數超過上限 → 不提供，提示縮小篩選範圍', async () => {
    renderWithTotal(10_001);
    await selectRows(0, 1, 2);
    expect(screen.queryByTestId('batch-select-all-matching')).not.toBeInTheDocument();
    expect(screen.getByTestId('batch-select-all-too-many')).toBeInTheDocument();
  });

  it('收集到一半取消 → 不確認、不送出任何請求', async () => {
    const hanging = vi.fn<BatchPageFetcher<Row>>(
      (_offset, _limit, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason));
        }),
    );
    renderWithTotal(MATCHING.length, hanging);
    await selectRows(0, 1, 2);
    await userEvent.click(screen.getByTestId('batch-select-all-matching'));
    await userEvent.click(screen.getByTestId('batch-action'));

    expect(await screen.findByTestId('batch-collecting')).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('batch-collect-cancel'));

    await waitFor(() => expect(screen.queryByTestId('batch-collecting')).not.toBeInTheDocument());
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.queryByTestId('batch-collect-error')).not.toBeInTheDocument();
    expect(runItem).not.toHaveBeenCalled();
  });
});
