import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { fn } from 'storybook/test';

import { JustifiedGrid } from './JustifiedGrid';
import type { JustifiedGridSection } from './JustifiedGrid';
import type { GridItemRect } from './layout';

/** 色塊輪流用的 token（不寫色碼）。 */
const FILLS = [
  'var(--color-fill)',
  'var(--color-success-fill)',
  'var(--color-warning-fill)',
  'var(--color-danger-fill)',
  'var(--color-fill-subtle)',
] as const;

/** 常見的寬高比；以固定的序列挑，每次重新整理的版面相同。 */
const RATIOS = [3 / 2, 2 / 3, 4 / 3, 1, 16 / 9, 3 / 4, 2, 9 / 16] as const;

function makeItems(prefix: string, count: number, seed = 0) {
  return Array.from({ length: count }, (_, index) => ({
    key: `${prefix}-${index}`,
    aspectRatio: RATIOS[(index * 5 + seed) % RATIOS.length] ?? 1,
  }));
}

function renderBlock(item: GridItemRect) {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'grid',
        placeItems: 'center',
        background: FILLS[item.globalIndex % FILLS.length],
        color: 'var(--color-fg-muted)',
        fontSize: 12,
      }}
    >
      {item.globalIndex + 1}
    </div>
  );
}

const meta = {
  title: 'Components/JustifiedGrid',
  component: JustifiedGrid,
  args: {
    sections: [{ key: 'all', items: makeItems('all', 60) }],
    mode: 'justified',
    rowHeight: 180,
    gap: 4,
    renderItem: renderBlock,
    onEndReached: fn(),
    onVisibleSectionChange: fn(),
    style: { height: 480 },
  },
  argTypes: {
    mode: { control: 'inline-radio', options: ['justified', 'square'] },
    rowHeight: { control: { type: 'range', min: 80, max: 360, step: 20 } },
    gap: { control: { type: 'range', min: 0, max: 16, step: 1 } },
  },
} satisfies Meta<typeof JustifiedGrid>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

/** 正方形方格：寬高比不影響格子，`rowHeight` 是格子邊長的目標。 */
export const Square: Story = {
  args: { mode: 'square', rowHeight: 120 },
};

/** 分區段：區段標題黏在上方，捲過區段底部時被下一段推走。 */
export const Sections: Story = {
  args: {
    sections: Array.from({ length: 8 }, (_, index) => ({
      key: `section-${index}`,
      label: `第 ${index + 1} 段`,
      items: makeItems(`section-${index}`, 7 + ((index * 7) % 13), index),
    })),
  },
};

function ManyItemsDemo() {
  const [sections] = useState<JustifiedGridSection[]>(() =>
    Array.from({ length: 50 }, (_, index) => ({
      key: `section-${index}`,
      label: `第 ${index + 1} 段（100 項）`,
      items: makeItems(`section-${index}`, 100, index),
    })),
  );
  const [top, setTop] = useState('section-0');
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <span>最上方的區段：{top}</span>
      <JustifiedGrid
        sections={sections}
        renderItem={renderBlock}
        onVisibleSectionChange={setTop}
        style={{ height: 520 }}
      />
    </div>
  );
}

/** 5,000 個項目：只渲染可視範圍上下各一屏的項目。 */
export const ManyItems: Story = {
  render: () => <ManyItemsDemo />,
};

function InfiniteDemo() {
  const [sections, setSections] = useState<JustifiedGridSection[]>([
    { key: 'page-0', label: '第 1 頁', items: makeItems('page-0', 40) },
  ]);
  const loadMore = () =>
    setSections((previous) =>
      previous.length >= 10
        ? previous
        : [
            ...previous,
            {
              key: `page-${previous.length}`,
              label: `第 ${previous.length + 1} 頁`,
              items: makeItems(`page-${previous.length}`, 40, previous.length),
            },
          ],
    );
  return (
    <JustifiedGrid
      sections={sections}
      renderItem={renderBlock}
      onEndReached={loadMore}
      style={{ height: 480 }}
    />
  );
}

/** 無限捲動：捲到距離底部 600 px 內就附加一個區段（最多 10 段）。 */
export const Infinite: Story = {
  render: () => <InfiniteDemo />,
};
