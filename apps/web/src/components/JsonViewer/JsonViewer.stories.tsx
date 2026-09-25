import type { Meta, StoryObj } from '@storybook/react-vite';

import { JsonViewer } from './JsonViewer';

const sample = {
  id: 'c0a8012e-7f3b-4c1d-9b2a-5e6f7a8b9c0d',
  name: '編輯者',
  isSystem: false,
  permissions: ['role:read', 'role:update', 'user:read'],
  limits: { maxProjects: 10, ratio: 0.75, expiresAt: null },
  note: '這一行很長，用來確認長字串不換行而是在框內水平捲動。'.repeat(4),
};

const large = {
  items: Array.from({ length: 2000 }, (_, index) => ({
    index,
    key: `item-${index}`,
    enabled: index % 3 === 0,
    tags: ['a', 'b'],
  })),
};

const meta = {
  title: 'Components/JsonViewer',
  component: JsonViewer,
  args: { value: sample, 'aria-label': 'JSON' },
  parameters: { layout: 'padded' },
} satisfies Meta<typeof JsonViewer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

/** 第 1 層以下一開始收合，點箭頭展開。 */
export const CollapsedByDefault: Story = {
  args: { defaultExpandDepth: 1 },
};

/** 上萬行：超過 `virtualThreshold` 自動虛擬捲動，只渲染可視範圍的行。 */
export const Large: Story = {
  args: { value: large },
};

export const Primitive: Story = {
  args: { value: null },
};
