import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { fn } from 'storybook/test';

import { Switch } from './Switch';

const meta = {
  title: 'Components/Switch',
  component: Switch,
  args: {
    'aria-label': '啟用通知',
    onCheckedChange: fn(),
  },
} satisfies Meta<typeof Switch>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const Checked: Story = {
  args: { checked: true },
};

export const Disabled: Story = {
  args: { disabled: true },
};

export const DisabledChecked: Story = {
  args: { disabled: true, checked: true },
};

/** 未受控時用 `defaultChecked`，自己維護切換狀態。 */
function ControlledDemo() {
  const [checked, setChecked] = useState(false);
  return <Switch aria-label="啟用通知" checked={checked} onCheckedChange={setChecked} />;
}

export const Controlled: Story = {
  render: () => <ControlledDemo />,
};
