import type { Meta, StoryObj } from '@storybook/react-vite';
import { useCallback, useEffect, useRef, useState } from 'react';

import { VirtualList } from './VirtualList';

const rows = Array.from({ length: 100_000 }, (_, index) => `第 ${index} 列`);

const meta = {
  title: 'Components/VirtualList',
  component: VirtualList<string>,
  args: {
    items: rows,
    getKey: (item: string) => item,
    renderItem: (item: string) => <div className="px-3 py-2 text-sm">{item}</div>,
    style: { height: 320, width: 320 },
    estimateSize: 36,
  },
} satisfies Meta<typeof VirtualList<string>>;

export default meta;
type Story = StoryObj<typeof meta>;

/** 十萬列：DOM 只有可視範圍的列。 */
export const Playground: Story = {};

function InfiniteDemo() {
  const [items, setItems] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const loadMore = useCallback(() => {
    setLoading(true);
    timer.current = setTimeout(() => {
      setItems((current) => [
        ...current,
        ...Array.from({ length: 50 }, (_, offset) => `第 ${current.length + offset} 列`),
      ]);
      setLoading(false);
    }, 600);
  }, []);

  return (
    <VirtualList
      items={items}
      getKey={(item) => item}
      renderItem={(item) => <div className="px-3 py-2 text-sm">{item}</div>}
      estimateSize={36}
      hasMore={items.length < 1000}
      loading={loading}
      onLoadMore={loadMore}
      emptyContent="沒有資料"
      style={{ height: 320, width: 320 }}
    />
  );
}

/** 無限捲動：每頁 50 筆、共 1000 筆。 */
export const InfiniteScroll: Story = {
  args: { items: [] },
  render: () => <InfiniteDemo />,
};
