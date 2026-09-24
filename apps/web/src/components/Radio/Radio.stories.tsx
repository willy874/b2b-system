import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { fn } from 'storybook/test';

import { RadioGroup } from './Radio';

const options = [
  { value: 'small', label: '小' },
  { value: 'medium', label: '中' },
  { value: 'large', label: '大' },
];

const meta = {
  title: 'Components/Radio',
  component: RadioGroup,
  args: { options, defaultValue: 'medium', onValueChange: fn() },
  argTypes: {
    orientation: { control: 'inline-radio', options: ['vertical', 'horizontal'] },
  },
} satisfies Meta<typeof RadioGroup>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const Horizontal: Story = {
  args: { orientation: 'horizontal' },
};

export const WithDescription: Story = {
  args: {
    options: [
      { value: 'free', label: '免費方案', description: '基本功能，適合個人使用' },
      { value: 'pro', label: '專業方案', description: '完整功能，適合團隊使用' },
    ],
    defaultValue: 'free',
  },
};

export const DisabledOption: Story = {
  args: {
    options: [
      { value: 'small', label: '小' },
      { value: 'medium', label: '中', disabled: true },
      { value: 'large', label: '大' },
    ],
  },
};

export const Disabled: Story = {
  args: { disabled: true },
};

function ControlledDemo() {
  const [value, setValue] = useState('medium');
  return <RadioGroup options={options} value={value} onValueChange={setValue} />;
}

export const Controlled: Story = {
  render: () => <ControlledDemo />,
};
