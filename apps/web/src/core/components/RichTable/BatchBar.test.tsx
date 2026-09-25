import type { ColumnDef } from '@tanstack/react-table';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useTableSelection } from '@/components/Table';
import type { BatchAction } from '@/core/batch';
import { AppError } from '@/core/errors';
import { useTableColumnSettingsStore } from '@/core/store';
import { AllProviders } from '@/test/renderWithPermissions';

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
const isDisabled = (element: HTMLElement) => element.matches(':disabled, [aria-disabled="true"]');
const columns: Array<ColumnDef<Row, unknown>> = [
  { id: 'name', header: 'Name', cell: ({ row }) => row.original.name },
];

function action(overrides: Partial<BatchAction<Row>> = {}): BatchAction<Row> {
  return {
    id: 'unlock',
    label: 'Unlock',
    isEligible: (row) => row.locked,
    confirm: ({ eligible }) => ({ title: 'Unlock?', description: `${eligible.length} rows` }),
    run: vi.fn(async (ids: string[]) => ({ succeeded: ids, failed: [] })),
    successMessage: (count) => `Unlocked ${count}`,
    ...overrides,
  };
}

function Harness({ actions }: { actions: Array<BatchAction<Row>> }) {
  const selection = useTableSelection(ROWS, getId);
  return (
    <>
      <RichTable
        data={ROWS}
        columns={columns}
        getRowId={getId}
        batch={{ selection, actions, getRowLabel: (row) => row.name }}
      />
      <output data-testid="selected">{selection.selectedIds.join(',')}</output>
    </>
  );
}

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

describe('RichTable 的批次操作（ADR-0009）', () => {
  beforeEach(() => {
    localStorage.clear();
    useTableColumnSettingsStore.setState({ settings: {}, pinnedRows: {} });
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

  it('只送出適用的列', async () => {
    const run = vi.fn(async (ids: string[]) => ({ succeeded: ids, failed: [] }));
    renderHarness([action({ run })]);
    await selectRows(0, 1, 2);
    await userEvent.click(screen.getByTestId('batch-action'));

    expect(await screen.findByRole('alertdialog')).toHaveTextContent('2 rows');
    await confirmBatch();

    await waitFor(() => expect(run).toHaveBeenCalledWith(['a', 'c']));
  });

  it('全部成功 → 成功的移出選取、顯示提示；略過的仍保持勾選', async () => {
    renderHarness([action()]);
    await selectRows(0, 1);
    await userEvent.click(screen.getByTestId('batch-action'));
    await confirmBatch();

    await waitFor(() => expect(screen.getByTestId('selected')).toHaveTextContent(/^b$/));
    expect(await screen.findByText('Unlocked 1')).toBeInTheDocument();
    expect(screen.queryByTestId('batch-result-dialog')).not.toBeInTheDocument();
  });

  it('部分失敗 → 結果對話框列出未完成項目；失敗的保留勾選，已不存在的移出', async () => {
    const run = vi.fn(async () => ({
      succeeded: [] as string[],
      failed: [
        { id: 'a', code: 'AUTHZ_SELF_MODIFY' },
        { id: 'c', code: 'USER_NOT_FOUND' },
      ],
    }));
    renderHarness([action({ run })]);
    await selectRows(0, 2);
    await userEvent.click(screen.getByTestId('batch-action'));
    await confirmBatch();

    const dialog = await screen.findByTestId('batch-result-dialog');
    const failures = within(dialog).getAllByTestId('batch-result-failure');
    expect(failures.map((item) => item.getAttribute('data-value'))).toEqual(['a', 'c']);
    expect(failures[0]).toHaveTextContent('Alice');
    expect(screen.getByTestId('selected')).toHaveTextContent(/^a$/);
  });

  it('整批失敗 → 確認框留著、選取不變', async () => {
    const run = vi.fn(async () => {
      throw new AppError('INTERNAL_ERROR', 500);
    });
    renderHarness([action({ run })]);
    await selectRows(0);
    await userEvent.click(screen.getByTestId('batch-action'));
    await confirmBatch();

    await waitFor(() => expect(run).toHaveBeenCalled());
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByTestId('selected')).toHaveTextContent(/^a$/);
  });

  it('跨頁累積超過 200 筆 → 所有動作停用', async () => {
    const many = Array.from({ length: 201 }, (_, i) => ({
      id: `r${i}`,
      name: `R${i}`,
      locked: true,
    }));
    function Many() {
      const selection = useTableSelection(many, getId);
      return (
        <RichTable
          data={many}
          columns={columns}
          getRowId={getId}
          batch={{ selection, actions: [action()], getRowLabel: (row) => row.name }}
        />
      );
    }
    render(<Many />, { wrapper: AllProviders });
    await userEvent.click(screen.getByTestId('table-select-all'));
    // 有說明文字時是 aria-disabled（可 hover），測試環境沒載入語系則是原生 disabled
    expect(screen.getByTestId('batch-action')).toSatisfy(isDisabled);
  });
});
