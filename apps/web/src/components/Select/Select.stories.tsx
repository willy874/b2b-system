import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { fn } from 'storybook/test';

import { Select } from './Select';

const options = [
  { value: 'draft', label: '草稿' },
  { value: 'published', label: '已發佈' },
  { value: 'archived', label: '已封存' },
];

const meta = {
  title: 'Components/Select',
  component: Select,
  args: { options, defaultValue: 'draft', onValueChange: fn() },
  argTypes: {
    size: { control: 'inline-radio', options: ['sm', 'md'] },
  },
} satisfies Meta<typeof Select>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const Placeholder: Story = {
  args: { defaultValue: null, placeholder: '請選擇狀態' },
};

export const Sizes: Story = {
  render: (args) => (
    <div className="flex items-center gap-2">
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

function ControlledDemo() {
  const [value, setValue] = useState('draft');
  return <Select options={options} value={value} onValueChange={setValue} />;
}

export const Controlled: Story = {
  render: () => <ControlledDemo />,
};
