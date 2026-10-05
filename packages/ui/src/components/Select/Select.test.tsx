import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { installFakeListLayout } from '../../testing/fakeLayout';
import { Select } from './index';
import type { SelectOption } from './index';

const options = [
  { value: 'active', label: '啟用' },
  { value: 'inactive', label: '停用' },
  { value: 'locked', label: '鎖定', disabled: true },
];

const fruits: SelectOption[] = [
  { value: 'apple', label: 'Apple' },
  { value: 'banana', label: 'Banana' },
  { value: 'cherry', label: 'Cherry' },
  { value: 'durian', label: 'Durian', disabled: true },
];

const tree: SelectOption[] = [
  {
    value: 'fruit',
    label: '水果',
    children: [
      { value: 'apple', label: 'Apple' },
      { value: 'banana', label: 'Banana' },
    ],
  },
  { value: 'rice', label: '米' },
];

/** 以固定的 `data-testid` ＋ `data-value` 找列（docs/conventions/06-literal-strings.md §3.3）。 */
function getRow(value: string) {
  const element = document.querySelector<HTMLElement>(
    `[data-testid="select-item"][data-value="${value}"]`,
  );
  if (!element) throw new Error(`找不到 select-item（data-value="${value}"）`);
  return element;
}

const rowValues = () =>
  Array.from(document.querySelectorAll('[data-testid="select-item"]')).map((row) =>
    row.getAttribute('data-value'),
  );

/** 開啟後等焦點進到列表（Base UI 的 initialFocus 是非同步的），之後的按鍵才會送到列表上。 */
async function openSelect(name = '狀態', role: 'listbox' | 'tree' = 'listbox') {
  await userEvent.click(screen.getByRole('combobox', { name }));
  const list = await screen.findByRole(role);
  await waitFor(() => expect(list).toHaveFocus());
  return list;
}

describe('Select（單選）', () => {
  it('點擊開啟並選取', async () => {
    const onValueChange = vi.fn();
    render(<Select options={options} onValueChange={onValueChange} aria-label="狀態" />);
    await userEvent.click(screen.getByRole('combobox', { name: '狀態' }));
    await userEvent.click(await screen.findByRole('option', { name: '停用' }));
    expect(onValueChange).toHaveBeenCalledWith('inactive');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('鍵盤可開啟與選取', async () => {
    const onValueChange = vi.fn();
    render(<Select options={options} onValueChange={onValueChange} aria-label="狀態" />);
    await userEvent.tab();
    await userEvent.keyboard('{Enter}');
    expect(await screen.findByRole('option', { name: '啟用' })).toBeVisible();
    await userEvent.keyboard('{ArrowDown}{Enter}');
    expect(onValueChange).toHaveBeenCalledWith('inactive');
  });

  it('方向鍵會跳過停用的選項', async () => {
    render(<Select options={options} aria-label="狀態" />);
    const listbox = await openSelect();
    await userEvent.keyboard('{End}');
    expect(listbox).toHaveAttribute('aria-activedescendant', getRow('inactive').id);
  });

  it('typeahead 以開頭文字跳到選項', async () => {
    render(<Select options={fruits} aria-label="水果" />);
    const listbox = await openSelect('水果');
    await userEvent.keyboard('c');
    expect(listbox).toHaveAttribute('aria-activedescendant', getRow('cherry').id);
  });

  it('disabled 時無法開啟', async () => {
    render(<Select options={options} disabled aria-label="狀態" />);
    await userEvent.click(screen.getByRole('combobox', { name: '狀態' }));
    expect(screen.queryByRole('option')).not.toBeInTheDocument();
  });

  it('顯示已選項目的標籤', () => {
    render(<Select options={options} value="inactive" aria-label="狀態" />);
    expect(screen.getByRole('combobox', { name: '狀態' })).toHaveTextContent('停用');
  });

  it('沒有值時顯示 placeholder', () => {
    render(<Select options={options} placeholder="請選擇" aria-label="狀態" />);
    const trigger = screen.getByRole('combobox', { name: '狀態' });
    expect(trigger).toHaveTextContent('請選擇');
    expect(trigger).toHaveAttribute('data-placeholder');
  });

  it('invalid 反映在 aria-invalid', () => {
    render(<Select options={options} invalid aria-label="狀態" />);
    expect(screen.getByRole('combobox', { name: '狀態' })).toHaveAttribute('aria-invalid', 'true');
  });

  it('尺寸以 data-size 屬性表現在觸發按鈕上', () => {
    render(<Select options={options} size="sm" aria-label="狀態" />);
    expect(screen.getByRole('combobox', { name: '狀態' })).toHaveAttribute('data-size', 'sm');
  });

  it('sortOptions 排序選項', async () => {
    render(<Select options={fruits} sortOptions="desc" aria-label="水果" />);
    await openSelect('水果');
    expect(rowValues()).toEqual(['durian', 'cherry', 'banana', 'apple']);
  });
});

describe('Select（多選）', () => {
  it('勾選不關閉，值依勾選先後排列', async () => {
    const onValueChange = vi.fn();
    render(<Select multiple options={fruits} onValueChange={onValueChange} aria-label="水果" />);
    const listbox = await openSelect('水果');
    expect(listbox).toHaveAttribute('aria-multiselectable', 'true');

    await userEvent.click(getRow('cherry'));
    await userEvent.click(getRow('apple'));
    expect(onValueChange).toHaveBeenLastCalledWith(['cherry', 'apple']);
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    expect(getRow('cherry')).toHaveAttribute('aria-selected', 'true');
  });

  it('觸發鈕上的標籤依勾選先後顯示', async () => {
    render(<Select multiple options={fruits} aria-label="水果" />);
    await openSelect('水果');
    await userEvent.click(getRow('cherry'));
    await userEvent.click(getRow('apple'));
    const tags = Array.from(document.querySelectorAll('[data-testid="select-tag"]'));
    expect(tags.map((tag) => tag.textContent)).toEqual(['Cherry', 'Apple']);
  });

  it('valueOrder="options" 時依選項順序排列', async () => {
    const onValueChange = vi.fn();
    render(
      <Select
        multiple
        valueOrder="options"
        options={fruits}
        onValueChange={onValueChange}
        aria-label="水果"
      />,
    );
    await openSelect('水果');
    await userEvent.click(getRow('cherry'));
    await userEvent.click(getRow('apple'));
    expect(onValueChange).toHaveBeenLastCalledWith(['apple', 'cherry']);
  });

  it('再點一次取消勾選', async () => {
    const onValueChange = vi.fn();
    render(
      <Select
        multiple
        options={fruits}
        defaultValue={['apple', 'banana']}
        onValueChange={onValueChange}
        aria-label="水果"
      />,
    );
    await openSelect('水果');
    await userEvent.click(getRow('apple'));
    expect(onValueChange).toHaveBeenLastCalledWith(['banana']);
  });

  it('全選只勾可用的選項，部分勾選時為 mixed，再按一次全部取消', async () => {
    const onValueChange = vi.fn();
    render(
      <Select
        multiple
        selectAll
        options={fruits}
        defaultValue={['banana']}
        onValueChange={onValueChange}
        aria-label="水果"
      />,
    );
    await openSelect('水果');
    const all = getRow('__all__');
    expect(all).toHaveAttribute('aria-checked', 'mixed');

    await userEvent.click(all);
    expect(onValueChange).toHaveBeenLastCalledWith(['banana', 'apple', 'cherry']);
    expect(all).toHaveAttribute('aria-selected', 'true');

    await userEvent.click(all);
    expect(onValueChange).toHaveBeenLastCalledWith([]);
  });

  it('Ctrl + A 切換全選', async () => {
    const onValueChange = vi.fn();
    render(<Select multiple options={fruits} onValueChange={onValueChange} aria-label="水果" />);
    await openSelect('水果');
    await userEvent.keyboard('{Control>}a{/Control}');
    expect(onValueChange).toHaveBeenLastCalledWith(['apple', 'banana', 'cherry']);
  });

  it('空白鍵勾選作用列', async () => {
    const onValueChange = vi.fn();
    render(<Select multiple options={fruits} onValueChange={onValueChange} aria-label="水果" />);
    await openSelect('水果');
    await userEvent.keyboard('{ArrowDown}{ }');
    expect(onValueChange).toHaveBeenLastCalledWith(['banana']);
  });

  it('pinSelected：開啟時已選項目排最前面，開啟期間勾選不重排', async () => {
    render(
      <Select multiple pinSelected options={fruits} defaultValue={['cherry']} aria-label="水果" />,
    );
    await openSelect('水果');
    expect(rowValues()).toEqual(['cherry', 'apple', 'banana', 'durian']);

    await userEvent.click(getRow('banana'));
    expect(rowValues()).toEqual(['cherry', 'apple', 'banana', 'durian']);
  });

  it('勾選新項目時列不重新掛載、捲動位置不變（不抖動）', async () => {
    render(<Select multiple options={fruits} aria-label="水果" />);
    const listbox = await openSelect('水果');
    const popup = listbox.parentElement as HTMLElement;
    popup.scrollTop = 40;
    const before = getRow('banana');

    await userEvent.click(getRow('apple'));
    await userEvent.click(getRow('banana'));

    expect(getRow('banana')).toBe(before);
    expect(popup.scrollTop).toBe(40);
    expect(rowValues()).toEqual(['apple', 'banana', 'cherry', 'durian']);
  });

  it('受控：只呼叫 onValueChange，畫面跟著 value', async () => {
    function Controlled() {
      const [value, setValue] = useState<string[]>([]);
      return (
        <>
          <Select
            multiple
            options={fruits}
            value={value}
            onValueChange={setValue}
            aria-label="水果"
          />
          <output data-testid="value">{value.join(',')}</output>
        </>
      );
    }
    render(<Controlled />);
    await openSelect('水果');
    await userEvent.click(getRow('banana'));
    await userEvent.click(getRow('apple'));
    expect(screen.getByTestId('value')).toHaveTextContent('banana,apple');
  });
});

describe('Select（可展開的列）', () => {
  it('群組列以 tree 呈現，點展開圖示顯示子選項', async () => {
    render(<Select options={tree} aria-label="分類" />);
    await userEvent.click(screen.getByRole('combobox', { name: '分類' }));
    await screen.findByRole('tree');
    expect(getRow('fruit')).toHaveAttribute('aria-expanded', 'false');
    expect(rowValues()).toEqual(['fruit', 'rice']);

    await userEvent.click(within(getRow('fruit')).getByText('水果'));
    expect(getRow('fruit')).toHaveAttribute('aria-expanded', 'true');
    expect(rowValues()).toEqual(['fruit', 'apple', 'banana', 'rice']);
    expect(getRow('apple')).toHaveAttribute('aria-level', '2');
  });

  it('單選時點群組列只展開，不會選取', async () => {
    const onValueChange = vi.fn();
    render(<Select options={tree} onValueChange={onValueChange} aria-label="分類" />);
    await userEvent.click(screen.getByRole('combobox', { name: '分類' }));
    await userEvent.click(await screen.findByText('水果'));
    expect(onValueChange).not.toHaveBeenCalled();
    await userEvent.click(getRow('banana'));
    expect(onValueChange).toHaveBeenCalledWith('banana');
  });

  it('selectableGroups：單選時點群組列就選取它，箭頭與 → 仍可展開', async () => {
    const onValueChange = vi.fn();
    render(
      <Select options={tree} selectableGroups onValueChange={onValueChange} aria-label="分類" />,
    );
    await userEvent.click(screen.getByRole('combobox', { name: '分類' }));
    await userEvent.click(await screen.findByText('水果'));
    expect(onValueChange).toHaveBeenCalledWith('fruit');
    expect(screen.getByRole('combobox', { name: '分類' })).toHaveTextContent('水果');

    const list = await openSelect('分類', 'tree');
    expect(getRow('fruit')).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('{ArrowRight}');
    expect(getRow('fruit')).toHaveAttribute('aria-expanded', 'true');
    expect(list).toHaveAttribute('aria-activedescendant', getRow('fruit').id);
  });

  it('selectableGroups：停用的群組只停用自己，子選項仍可選、鍵盤仍可停在群組上展開', async () => {
    const onValueChange = vi.fn();
    const withDisabledFruit = tree.map((option) =>
      option.value === 'fruit' ? { ...option, disabled: true } : option,
    );
    render(
      <Select
        options={withDisabledFruit}
        selectableGroups
        onValueChange={onValueChange}
        aria-label="分類"
      />,
    );
    const list = await openSelect('分類', 'tree');
    expect(list).toHaveAttribute('aria-activedescendant', getRow('fruit').id);
    expect(getRow('fruit')).toHaveAttribute('aria-disabled', 'true');
    await userEvent.keyboard('{Enter}');
    expect(onValueChange).not.toHaveBeenCalled();
    await userEvent.keyboard('{ArrowRight}{ArrowDown}{Enter}');
    expect(onValueChange).toHaveBeenCalledWith('apple');
  });

  it('←／→ 收合與展開，← 在子列時回到父列', async () => {
    render(<Select options={tree} aria-label="分類" />);
    const list = await openSelect('分類', 'tree');
    await userEvent.keyboard('{ArrowRight}');
    expect(getRow('fruit')).toHaveAttribute('aria-expanded', 'true');
    await userEvent.keyboard('{ArrowRight}');
    expect(list).toHaveAttribute('aria-activedescendant', getRow('apple').id);
    await userEvent.keyboard('{ArrowLeft}');
    expect(list).toHaveAttribute('aria-activedescendant', getRow('fruit').id);
    await userEvent.keyboard('{ArrowLeft}');
    expect(getRow('fruit')).toHaveAttribute('aria-expanded', 'false');
  });

  it('多選時勾群組等於勾選所有子選項，部分勾選為 mixed', async () => {
    const onValueChange = vi.fn();
    render(
      <Select
        multiple
        options={tree}
        defaultExpandedValues={['fruit']}
        onValueChange={onValueChange}
        aria-label="分類"
      />,
    );
    await userEvent.click(screen.getByRole('combobox', { name: '分類' }));
    await screen.findByRole('tree');
    await userEvent.click(getRow('banana'));
    expect(getRow('fruit')).toHaveAttribute('aria-checked', 'mixed');

    await userEvent.click(getRow('fruit'));
    expect(onValueChange).toHaveBeenLastCalledWith(['banana', 'apple']);
    expect(getRow('fruit')).toHaveAttribute('aria-selected', 'true');
  });
});

describe('Select（大量資料）', () => {
  let layout: ReturnType<typeof installFakeListLayout> | undefined;
  afterEach(() => {
    layout?.restore();
    layout = undefined;
  });

  const many = Array.from({ length: 5000 }, (_, index) => ({
    value: `item-${index}`,
    label: `Item ${index}`,
  }));

  it('超過門檻時只渲染可視範圍的列', async () => {
    layout = installFakeListLayout();
    render(<Select options={many} aria-label="項目" />);
    await openSelect('項目');
    const rendered = rowValues().length;
    expect(rendered).toBeGreaterThan(0);
    expect(rendered).toBeLessThan(50);
  });

  it('鍵盤 End 跳到最後一列並把它渲染出來', async () => {
    layout = installFakeListLayout();
    render(<Select options={many} aria-label="項目" />);
    const listbox = await openSelect('項目');
    await userEvent.keyboard('{End}');
    await waitFor(() => expect(getRow('item-4999')).toBeInTheDocument());
    expect(listbox).toHaveAttribute('aria-activedescendant', getRow('item-4999').id);
    expect(rowValues()).not.toContain('item-0');
  });

  it('內容不滿一屏且有下一頁時呼叫 onLoadMore；載入中不重複呼叫', async () => {
    const onLoadMore = vi.fn();
    const { rerender } = render(
      <Select options={fruits} hasMore onLoadMore={onLoadMore} aria-label="水果" />,
    );
    await openSelect('水果');
    expect(onLoadMore).toHaveBeenCalledTimes(1);

    rerender(<Select options={fruits} hasMore loading onLoadMore={onLoadMore} aria-label="水果" />);
    expect(screen.getByRole('status', { name: '載入中…' })).toBeInTheDocument();
    expect(onLoadMore).toHaveBeenCalledTimes(1);

    const more = [...fruits, { value: 'elder', label: 'Elder' }];
    rerender(<Select options={more} hasMore onLoadMore={onLoadMore} aria-label="水果" />);
    expect(onLoadMore).toHaveBeenCalledTimes(2);
  });

  it('沒有下一頁時不呼叫 onLoadMore，沒有選項時顯示 emptyLabel', async () => {
    const onLoadMore = vi.fn();
    render(<Select options={[]} onLoadMore={onLoadMore} emptyLabel="沒有資料" aria-label="水果" />);
    await openSelect('水果');
    expect(onLoadMore).not.toHaveBeenCalled();
    expect(screen.getByText('沒有資料')).toBeInTheDocument();
  });
});

async function openSearch(name: string) {
  await userEvent.click(screen.getByRole('combobox', { name }));
  const input = await screen.findByRole('combobox', { name: '搜尋…' });
  await waitFor(() => expect(input).toHaveFocus());
  return input;
}

describe('Select（搜尋）', () => {
  it('輸入關鍵字過濾選項（不分大小寫），Enter 選取第一個符合的', async () => {
    const onValueChange = vi.fn();
    render(<Select searchable options={fruits} onValueChange={onValueChange} aria-label="水果" />);
    const input = await openSearch('水果');
    await userEvent.type(input, 'BAN');
    await waitFor(() => expect(rowValues()).toEqual(['banana']));
    expect(input).toHaveAttribute('aria-activedescendant', getRow('banana').id);

    await userEvent.keyboard('{Enter}');
    expect(onValueChange).toHaveBeenCalledWith('banana');
  });

  it('空白鍵是輸入文字，不會選取', async () => {
    const onValueChange = vi.fn();
    render(
      <Select
        multiple
        searchable
        options={fruits}
        onValueChange={onValueChange}
        aria-label="水果"
      />,
    );
    const input = await openSearch('水果');
    await userEvent.type(input, 'a ');
    expect(input).toHaveValue('a ');
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it('沒有符合時顯示 noMatchLabel；關閉後清空關鍵字', async () => {
    render(<Select searchable options={fruits} noMatchLabel="找不到" aria-label="水果" />);
    const input = await openSearch('水果');
    await userEvent.type(input, 'zzz');
    expect(await screen.findByText('找不到')).toBeInTheDocument();

    await userEvent.keyboard('{Escape}');
    await openSearch('水果');
    expect(screen.getByRole('combobox', { name: '搜尋…' })).toHaveValue('');
    expect(rowValues()).toHaveLength(fruits.length);
  });

  it('群組只留下有符合子孫的，並自動展開', async () => {
    render(<Select searchable options={tree} aria-label="分類" />);
    const input = await openSearch('分類');
    await userEvent.type(input, 'ban');
    await waitFor(() => expect(rowValues()).toEqual(['fruit', 'banana']));
    expect(getRow('fruit')).toHaveAttribute('aria-expanded', 'true');
  });

  it('搜尋中全選只作用在符合的選項', async () => {
    const onValueChange = vi.fn();
    render(
      <Select
        multiple
        selectAll
        searchable
        options={fruits}
        defaultValue={['cherry']}
        onValueChange={onValueChange}
        aria-label="水果"
      />,
    );
    const input = await openSearch('水果');
    await userEvent.type(input, 'ban');
    await waitFor(() => expect(rowValues()).toEqual(['__all__', 'banana']));
    await userEvent.click(getRow('__all__'));
    expect(onValueChange).toHaveBeenLastCalledWith(['cherry', 'banana']);
  });

  it('filterOption={false}：不在本地過濾，交給 onSearchChange（後端搜尋）', async () => {
    const onSearchChange = vi.fn();
    render(
      <Select
        searchable
        filterOption={false}
        options={fruits}
        onSearchChange={onSearchChange}
        aria-label="水果"
      />,
    );
    const input = await openSearch('水果');
    await userEvent.type(input, 'ch');
    expect(onSearchChange).toHaveBeenLastCalledWith('ch');
    expect(rowValues()).toHaveLength(fruits.length);
  });

  it('換關鍵字後，筆數與上一頁相同也會再要下一頁', async () => {
    const onLoadMore = vi.fn();
    function Remote() {
      const [query, setQuery] = useState('');
      const items = fruits.map((fruit) => ({
        label: fruit.label,
        value: `${query}-${fruit.value}`,
      }));
      return (
        <Select
          searchable
          filterOption={false}
          options={items}
          searchValue={query}
          onSearchChange={setQuery}
          hasMore
          onLoadMore={onLoadMore}
          aria-label="水果"
        />
      );
    }
    render(<Remote />);
    const input = await openSearch('水果');
    expect(onLoadMore).toHaveBeenCalledTimes(1);
    await userEvent.type(input, 'x');
    await waitFor(() => expect(onLoadMore).toHaveBeenCalledTimes(2));
  });

  it('選項的 description 顯示在標籤下方', async () => {
    render(
      <Select
        options={[{ value: 'a', label: 'Alice', description: 'alice@example.com' }]}
        aria-label="使用者"
      />,
    );
    await openSelect('使用者');
    expect(getRow('a')).toHaveAttribute('data-described');
    expect(within(getRow('a')).getByText('alice@example.com')).toBeInTheDocument();
  });
});
