import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { fn } from 'storybook/test';

import { JsonViewer } from '../JsonViewer';
import { JsonEditor } from './JsonEditor';

const sample = {
  id: 'hero-001',
  name: '勇者',
  level: 12,
  isBoss: false,
  skills: ['slash', 'guard'],
  stats: { hp: 320, mp: 45, speed: 1.25 },
  drop: null,
};

const large = {
  enemies: Array.from({ length: 1500 }, (_, index) => ({
    id: `enemy-${index}`,
    hp: 100 + index,
    tags: ['melee'],
  })),
};

const meta = {
  title: 'Components/JsonEditor',
  component: JsonEditor,
  args: { defaultValue: sample, onChange: fn(), 'aria-label': 'JSON' },
  parameters: { layout: 'padded' },
} satisfies Meta<typeof JsonEditor>;

export default meta;
type Story = StoryObj<typeof meta>;

/** 點鍵名或值直接編輯；每行右側的「⋯」有插入、複製、轉換型別、刪除。 */
export const Playground: Story = {};

/** 受控：下方的 JsonViewer 顯示 `onChange` 回報的值。 */
export const Controlled: Story = {
  render: (args) => <ControlledDemo {...args} />,
};

function ControlledDemo(args: Story['args']) {
  const [value, setValue] = useState<unknown>(sample);
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <JsonEditor {...args} defaultValue={undefined} value={value} onChange={setValue} />
      <JsonViewer value={value} aria-label="目前的值" />
    </div>
  );
}

export const TextMode: Story = {
  args: { defaultMode: 'text' },
};

export const ReadOnly: Story = {
  args: { readOnly: true },
};

/** 數千行：樹狀模式虛擬捲動。 */
export const Large: Story = {
  args: { defaultValue: large, defaultExpandDepth: 2 },
};
