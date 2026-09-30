import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { fn } from 'storybook/test';

import { Checkbox } from './Checkbox';

const meta = {
  title: 'Components/Checkbox',
  component: Checkbox,
  args: { label: '接受服務條款', onCheckedChange: fn() },
} satisfies Meta<typeof Checkbox>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const WithDescription: Story = {
  args: { description: '同意後才能繼續下一步。' },
};

export const Checked: Story = {
  args: { checked: true },
};

export const Indeterminate: Story = {
  args: { indeterminate: true },
};

export const Disabled: Story = {
  args: { disabled: true },
};

export const WithoutLabel: Story = {
  args: { label: undefined, 'aria-label': '接受服務條款' },
};

/** 展示受控用法：checked 狀態由外部 state 管理。 */
function ControlledDemo() {
  const [checked, setChecked] = useState(false);
  return <Checkbox label="接受服務條款" checked={checked} onCheckedChange={setChecked} />;
}

export const Controlled: Story = {
  render: () => <ControlledDemo />,
};
