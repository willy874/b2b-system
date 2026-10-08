import type { SortEntry } from '@b2b-system/web-shared/constants';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { FilterBar } from './FilterBar';
import type { FilterBarProps } from './FilterBar';

type Field = 'createdAt' | 'name' | 'slug';
type Values = { sort: Array<SortEntry<Field>> };

const DEFAULT_SORT: Array<SortEntry<Field>> = [{ sort: 'createdAt', order: 'desc' }];

function renderSort(overrides: Partial<FilterBarProps<Values>> = {}) {
  const props: FilterBarProps<Values> = {
    value: { sort: DEFAULT_SORT },
    defaultValue: { sort: DEFAULT_SORT },
    onSubmit: vi.fn(),
    fields: [
      {
        type: 'sort',
        key: 'sort',
        label: '排序',
        options: [
          { value: 'createdAt', label: '建立時間' },
          { value: 'name', label: '名稱' },
          { value: 'slug', label: '識別碼' },
        ],
      },
    ],
    ...overrides,
  };
  render(<FilterBar {...props} />);
  return props;
}

async function openPanel(): Promise<void> {
  await userEvent.click(screen.getByTestId('filter-bar-trigger'));
  await screen.findByTestId('filter-bar-popup');
}

function rows(): HTMLElement[] {
  return screen.getAllByTestId('filter-bar-sort-row');
}

async function submit(): Promise<void> {
  await userEvent.click(screen.getByTestId('filter-bar-submit'));
}

describe('FilterBar 的 sort 欄位（多欄排序）', () => {
  it('與預設排序相同時不計入數量，不同才計入', () => {
    renderSort({ value: { sort: [{ sort: 'name', order: 'asc' }] } });
    expect(screen.getByTestId('filter-bar-trigger')).toHaveTextContent('1');
  });

  it('預設排序不計入數量', () => {
    renderSort();
    expect(screen.getByTestId('filter-bar-trigger').textContent).not.toMatch(/\d/);
  });

  it('新增條件會挑第一個還沒用過的欄位、預設升冪', async () => {
    const { onSubmit } = renderSort();
    await openPanel();
    await userEvent.click(screen.getByTestId('filter-bar-sort-add'));
    expect(rows().map((row) => row.dataset.value)).toEqual(['createdAt', 'name']);

    await submit();
    expect(onSubmit).toHaveBeenCalledWith({
      sort: [
        { sort: 'createdAt', order: 'desc' },
        { sort: 'name', order: 'asc' },
      ],
    });
  });

  it('每列的欄位選單只列出自己與還沒被選走的欄位', async () => {
    renderSort({
      value: {
        sort: [
          { sort: 'createdAt', order: 'desc' },
          { sort: 'name', order: 'asc' },
        ],
      },
    });
    await openPanel();
    const second = rows()[1];
    if (!second) throw new Error('找不到第二列');
    await userEvent.click(within(second).getAllByRole('combobox')[0]!);
    expect(await screen.findByRole('option', { name: '名稱' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: '識別碼' })).toBeInTheDocument();
    // 第一列已經用了「建立時間」
    expect(screen.queryByRole('option', { name: '建立時間' })).not.toBeInTheDocument();
  });

  it('改方向、移除條件都只改草稿，送出時一次回報', async () => {
    const { onSubmit } = renderSort({
      value: {
        sort: [
          { sort: 'createdAt', order: 'desc' },
          { sort: 'name', order: 'asc' },
        ],
      },
    });
    await openPanel();
    const first = rows()[0];
    if (!first) throw new Error('找不到第一列');
    await userEvent.click(within(first).getAllByRole('combobox')[1]!);
    // 單元測試沒有載入語系包，方向選項沒有文字；第一個選項是升冪
    const [ascending] = await screen.findAllByRole('option');
    if (!ascending) throw new Error('找不到方向選項');
    await userEvent.click(ascending);
    const second = rows()[1];
    if (!second) throw new Error('找不到第二列');
    await userEvent.click(within(second).getAllByRole('button').at(-1)!);
    expect(onSubmit).not.toHaveBeenCalled();

    await submit();
    expect(onSubmit).toHaveBeenCalledWith({ sort: [{ sort: 'createdAt', order: 'asc' }] });
  });

  it('全部欄位都用上後不能再新增', async () => {
    renderSort({
      value: {
        sort: [
          { sort: 'createdAt', order: 'desc' },
          { sort: 'name', order: 'asc' },
          { sort: 'slug', order: 'asc' },
        ],
      },
    });
    await openPanel();
    expect(screen.getByTestId('filter-bar-sort-add')).toBeDisabled();
  });

  it('全部移除時送出空陣列（由頁面決定退回預設），「清除」回到 defaultValue', async () => {
    const { onSubmit } = renderSort({ value: { sort: [{ sort: 'name', order: 'asc' }] } });
    await openPanel();
    await userEvent.click(within(rows()[0]!).getAllByRole('button').at(-1)!);
    await submit();
    expect(onSubmit).toHaveBeenLastCalledWith({ sort: [] });

    await openPanel();
    await userEvent.click(screen.getByTestId('filter-bar-reset'));
    expect(rows().map((row) => row.dataset.value)).toEqual(['createdAt']);
  });

  it('每列有可用鍵盤操作的拖曳把手（調整優先順序）', async () => {
    renderSort({
      value: {
        sort: [
          { sort: 'createdAt', order: 'desc' },
          { sort: 'name', order: 'asc' },
        ],
      },
    });
    await openPanel();
    const handles = document.querySelectorAll('[aria-roledescription="sortable"]');
    expect(handles).toHaveLength(2);
    for (const handle of handles) expect(handle).toHaveAttribute('tabindex', '0');
  });

  it('換掉某一列的欄位，保留它的方向與位置', async () => {
    const { onSubmit } = renderSort({
      value: {
        sort: [
          { sort: 'createdAt', order: 'desc' },
          { sort: 'name', order: 'asc' },
        ],
      },
    });
    await openPanel();
    await userEvent.click(within(rows()[0]!).getAllByRole('combobox')[0]!);
    await userEvent.click(await screen.findByRole('option', { name: '識別碼' }));

    await submit();

    expect(onSubmit).toHaveBeenCalledWith({
      sort: [
        { sort: 'slug', order: 'desc' },
        { sort: 'name', order: 'asc' },
      ],
    });
  });

  it('值不是排序條件的陣列時當作沒有條件', async () => {
    renderSort({ value: { sort: 'createdAt' as unknown as Array<SortEntry<Field>> } });
    await openPanel();
    expect(screen.queryAllByTestId('filter-bar-sort-row')).toHaveLength(0);
  });
});
