import type { Meta, StoryObj } from '@storybook/react-vite';
import { useCallback, useEffect, useRef, useState } from 'react';
import { fn } from 'storybook/test';

import { Button } from '../Button';
import { Menu } from './Menu';
import type { MenuItemDescriptor } from './Menu';

const meta = {
  title: 'Components/Menu',
  component: Menu,
  args: {
    trigger: <Button>操作</Button>,
    items: [
      { key: 'edit', label: '編輯', onSelect: fn() },
      { key: 'delete', label: '刪除', tone: 'danger', onSelect: fn() },
    ],
  },
  argTypes: {
    align: { control: 'inline-radio', options: ['start', 'center', 'end'] },
  },
} satisfies Meta<typeof Menu>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const WithDisabledItem: Story = {
  args: {
    items: [
      { key: 'edit', label: '編輯', onSelect: fn() },
      { key: 'archive', label: '封存', disabled: true, onSelect: fn() },
      { key: 'delete', label: '刪除', tone: 'danger', onSelect: fn() },
    ],
  },
};

export const Align: Story = {
  render: (args) => (
    <div className="flex gap-8">
      <Menu {...args} trigger={<Button>靠左</Button>} align="start" />
      <Menu {...args} trigger={<Button>置中</Button>} align="center" />
      <Menu {...args} trigger={<Button>靠右</Button>} align="end" />
    </div>
  ),
};

/** 五千個項目：超過 100 個自動虛擬捲動；鍵盤 ↑↓ / Home / End / 字首跳轉都可用。 */
export const Virtualized: Story = {
  args: {
    trigger: <Button>五千個項目</Button>,
    items: Array.from({ length: 5000 }, (_, index) => ({
      key: `item-${index}`,
      label: `項目 ${index}`,
      onSelect: fn(),
    })),
  },
};

const PAGE_SIZE = 20;
const TOTAL = 200;

function InfiniteDemo() {
  const [items, setItems] = useState<MenuItemDescriptor[]>([]);
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
          return { key: `project-${index}`, label: `專案 ${index}` };
        }),
      ]);
      setLoading(false);
    }, 600);
  }, []);

  return (
    <Menu
      trigger={<Button>切換專案</Button>}
      items={items}
      hasMore={items.length < TOTAL}
      loading={loading}
      onLoadMore={loadMore}
      emptyLabel="沒有專案"
    />
  );
}

/** 無限捲動：開啟時載入第一頁，捲到底再要下一頁（每頁 20 筆、共 200 筆）。 */
export const InfiniteScroll: Story = {
  render: () => <InfiniteDemo />,
};
