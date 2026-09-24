import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { fn } from 'storybook/test';

import type { ComboboxOption } from './Combobox';
import { Combobox } from './Combobox';

const options: ComboboxOption[] = [
  { value: 'apple', label: '蘋果' },
  { value: 'banana', label: '香蕉' },
  { value: 'cherry', label: '櫻桃', description: '產季短暫' },
  { value: 'durian', label: '榴槤', disabled: true },
];

const meta = {
  title: 'Components/Combobox',
  component: Combobox,
  // 元件寬度是 100%，在置中版面裡要給容器寬度才看得出樣子
  decorators: [
    (Story) => (
      <div className="w-80">
        <Story />
      </div>
    ),
  ],
  args: { options, placeholder: '選擇一種水果', onValueChange: fn() },
} satisfies Meta<typeof Combobox>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const WithValue: Story = {
  args: { value: 'banana' },
};

export const Invalid: Story = {
  args: { invalid: true },
};

export const Disabled: Story = {
  args: { disabled: true },
};

export const Empty: Story = {
  args: { options: [] },
};

/** 展示受控用法：value 狀態由外部 state 管理。 */
function ControlledDemo() {
  const [value, setValue] = useState<string | null>(null);
  return (
    <Combobox options={options} value={value} onValueChange={setValue} placeholder="選擇一種水果" />
  );
}

export const Controlled: Story = {
  render: () => <ControlledDemo />,
};
