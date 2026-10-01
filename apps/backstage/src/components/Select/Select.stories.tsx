import type { Meta, StoryObj } from '@storybook/react-vite';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ComponentType } from 'react';
import { fn } from 'storybook/test';

import { Select } from './Select';
import type { SelectOption, SingleSelectProps } from './Select';

const options = [
  { value: 'draft', label: '草稿' },
  { value: 'published', label: '已發佈' },
  { value: 'archived', label: '已封存' },
];

const fruits: SelectOption[] = [
  { value: 'banana', label: 'Banana' },
  { value: 'apple', label: 'Apple' },
  { value: 'cherry', label: 'Cherry' },
  { value: 'durian', label: 'Durian', disabled: true },
  { value: 'elderberry', label: 'Elderberry' },
  { value: 'fig', label: 'Fig' },
  { value: 'grape', label: 'Grape' },
  { value: 'kiwi', label: 'Kiwi' },
  { value: 'lemon', label: 'Lemon' },
  { value: 'mango', label: 'Mango' },
];

const regions: SelectOption[] = [
  {
    value: 'asia',
    label: '亞洲',
    children: [
      { value: 'tw', label: '台灣' },
      { value: 'jp', label: '日本' },
      {
        value: 'sea',
        label: '東南亞',
        children: [
          { value: 'sg', label: '新加坡' },
          { value: 'th', label: '泰國' },
          { value: 'vn', label: '越南', disabled: true },
        ],
      },
    ],
  },
  {
    value: 'europe',
    label: '歐洲',
    children: [
      { value: 'de', label: '德國' },
      { value: 'fr', label: '法國' },
    ],
  },
  { value: 'other', label: '其他' },
];

const many = Array.from({ length: 10_000 }, (_, index) => ({
  value: `item-${index}`,
  label: `項目 ${index}`,
}));

const meta: Meta<SingleSelectProps> = {
  title: 'Components/Select',
  // 單選與多選是同一個元件的兩種 props（聯集）；Storybook 的 controls 以單選為準，多選看下方的 story
  component: Select as ComponentType<SingleSelectProps>,
  // 元件寬度是 100%，在置中版面裡要給容器寬度才看得出樣子
  decorators: [
    (Story) => (
      <div className="w-80">
        <Story />
      </div>
    ),
  ],
  args: { options, defaultValue: 'draft', onValueChange: fn() },
  argTypes: {
    size: { control: 'inline-radio', options: ['sm', 'md'] },
    sortOptions: { control: 'inline-radio', options: [undefined, 'asc', 'desc'] },
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const Placeholder: Story = {
  args: { defaultValue: null, placeholder: '請選擇狀態' },
};

export const Sizes: Story = {
  render: (args) => (
    <div className="grid gap-2">
      <Select {...args} size="sm" />
      <Select {...args} size="md" />
    </div>
  ),
};

export const Invalid: Story = {
  args: { invalid: true },
};

export const Disabled: Story = {
  args: { disabled: true },
};

export const DisabledOption: Story = {
  args: {
    options: [
      { value: 'draft', label: '草稿' },
      { value: 'published', label: '已發佈', disabled: true },
      { value: 'archived', label: '已封存' },
    ],
  },
};

/** 選項排序：`asc` / `desc` 以自然順序（數字 2 在 10 前面），也可以傳比較函式。 */
export const SortedOptions: Story = {
  args: { options: fruits, defaultValue: null, placeholder: '選擇水果', sortOptions: 'asc' },
};

function ControlledDemo() {
  const [value, setValue] = useState('draft');
  return <Select options={options} value={value} onValueChange={setValue} />;
}

export const Controlled: Story = {
  render: () => <ControlledDemo />,
};

function MultipleDemo({ valueOrder }: { valueOrder: 'selection' | 'options' }) {
  const [value, setValue] = useState<string[]>([]);
  return (
    <div className="grid gap-2">
      <Select
        multiple
        valueOrder={valueOrder}
        options={fruits}
        value={value}
        onValueChange={setValue}
        placeholder="選擇水果"
        aria-label="水果"
        data-testid="fruit-select"
      />
      {/* break-all：JSON 沒有斷行點，不斷行會把 grid 欄（連同 Select）撐寬 */}
      <output className="text-sm break-all" data-testid="fruit-value">
        {JSON.stringify(value)}
      </output>
    </div>
  );
}

/** 多選：標籤與 `onValueChange` 的值依 **勾選先後** 排列；放不下的標籤收成 `+N`。 */
export const Multiple: Story = {
  render: () => <MultipleDemo valueOrder="selection" />,
};

/** 多選但值依選項順序排列（`valueOrder="options"`）。 */
export const MultipleOptionOrder: Story = {
  render: () => <MultipleDemo valueOrder="options" />,
};

/** 全選列（部分勾選時為半勾）；Ctrl/⌘ + A 也會切換全選。停用的選項不受影響。 */
export const SelectAll: Story = {
  render: () => (
    <Select multiple selectAll options={fruits} defaultValue={['cherry']} aria-label="水果" />
  ),
};

/** 開啟時已選項目排最前面；開啟期間勾選不重排，列表不會跳。 */
export const PinSelected: Story = {
  render: () => (
    <Select
      multiple
      pinSelected
      options={fruits}
      defaultValue={['mango', 'fig']}
      aria-label="水果"
    />
  ),
};

/** 最多顯示 2 個標籤。 */
export const MaxTagCount: Story = {
  render: () => (
    <Select
      multiple
      maxTagCount={2}
      options={fruits}
      defaultValue={['apple', 'banana', 'cherry', 'fig']}
      aria-label="水果"
    />
  ),
};

/** 可展開的列（單選）：群組列只負責展開，←／→ 收合與展開。 */
export const ExpandableRows: Story = {
  render: () => (
    <Select
      options={regions}
      defaultExpandedValues={['asia']}
      placeholder="選擇地區"
      aria-label="地區"
    />
  ),
};

/** 群組列也能選（`selectableGroups`，例如資料夾樹）：點列選取，展開收合用列首箭頭或 ←／→。 */
export const SelectableGroups: Story = {
  render: () => (
    <Select
      options={regions}
      selectableGroups
      defaultExpandedValues={['asia']}
      placeholder="選擇地區"
      aria-label="地區"
    />
  ),
};

/** 可展開的列（多選）：勾群組等於勾選底下所有可用選項，部分勾選時為半勾。 */
export const ExpandableRowsMultiple: Story = {
  render: () => (
    <Select
      multiple
      selectAll
      options={regions}
      defaultExpandedValues={['asia', 'sea']}
      placeholder="選擇地區"
      aria-label="地區"
    />
  ),
};

/** 一萬筆選項：超過 100 筆自動虛擬捲動，DOM 只有可視範圍的列。 */
export const Virtualized: Story = {
  render: () => (
    <Select
      multiple
      selectAll
      options={many}
      placeholder="選擇項目"
      aria-label="項目"
      data-testid="virtual-select"
    />
  ),
};

const PAGE_SIZE = 30;
const TOTAL = 300;

function InfiniteDemo() {
  const [items, setItems] = useState<SelectOption[]>([]);
  const [loading, setLoading] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const loadMore = useCallback(() => {
    setLoading(true);
    // 模擬 API 延遲
    timer.current = setTimeout(() => {
      setItems((current) => [
        ...current,
        ...Array.from({ length: PAGE_SIZE }, (_, offset) => {
          const index = current.length + offset;
          return { value: `user-${index}`, label: `使用者 ${index}` };
        }),
      ]);
      setLoading(false);
    }, 600);
  }, []);

  return (
    <Select
      multiple
      options={items}
      hasMore={items.length < TOTAL}
      loading={loading}
      onLoadMore={loadMore}
      placeholder="選擇使用者"
      aria-label="使用者"
    />
  );
}

/** 無限捲動：捲到底自動要下一頁（每頁 30 筆、共 300 筆）；已選的值不會因為載入而跳動。 */
export const InfiniteScroll: Story = {
  render: () => <InfiniteDemo />,
};

const users: SelectOption[] = Array.from({ length: 500 }, (_, index) => ({
  value: `user-${index}`,
  label: `使用者 ${index}`,
  description: `user${index}@example.com`,
}));

/** 搜尋（取代原本的 Combobox）：本地過濾，Enter 選取第一個符合的；選項可以有兩行的 `description`。 */
export const Searchable: Story = {
  render: () => (
    <Select
      searchable
      options={users}
      itemSize={48}
      placeholder="選擇使用者"
      searchPlaceholder="搜尋名稱"
      aria-label="使用者"
    />
  ),
};

/** 搜尋 ＋ 多選 ＋ 樹：群組只留下有符合子孫的並自動展開；全選只作用在符合的選項。 */
export const SearchableTree: Story = {
  render: () => (
    <Select
      multiple
      selectAll
      searchable
      options={regions}
      placeholder="選擇地區"
      aria-label="地區"
    />
  ),
};

function RemoteSearchDemo() {
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<SelectOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  // 模擬後端：依關鍵字過濾、每頁 30 筆
  const fetchPage = useCallback((keyword: string, offset: number) => {
    setLoading(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const matched = many.filter((item) => item.label.includes(keyword));
      const page = matched.slice(offset, offset + 30);
      setItems((current) => (offset === 0 ? page : [...current, ...page]));
      setHasMore(offset + page.length < matched.length);
      setLoading(false);
    }, 400);
  }, []);

  return (
    <Select
      multiple
      searchable
      filterOption={false}
      searchValue={query}
      onSearchChange={(next) => {
        setQuery(next);
        setItems([]);
        fetchPage(next, 0);
      }}
      options={items}
      hasMore={hasMore}
      loading={loading}
      onLoadMore={() => fetchPage(query, items.length)}
      placeholder="選擇項目"
      searchPlaceholder="輸入數字搜尋"
      aria-label="項目"
    />
  );
}

/** 後端搜尋 ＋ 無限捲動：`filterOption={false}`，關鍵字改變時從第一頁重新載入。 */
export const RemoteSearch: Story = {
  render: () => <RemoteSearchDemo />,
};
