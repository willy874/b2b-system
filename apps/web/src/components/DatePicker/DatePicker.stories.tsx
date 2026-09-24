import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { fn } from 'storybook/test';

import type { DateValue } from './calendar-utils';
import { DatePicker } from './DatePicker';

const meta = {
  title: 'Components/DatePicker',
  component: DatePicker,
  args: { value: null, onValueChange: fn() },
} satisfies Meta<typeof DatePicker>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const WithValue: Story = {
  args: { value: '2024-03-15' },
};

export const WithMinMax: Story = {
  args: { min: '2024-03-01', max: '2024-03-20', defaultMonth: '2024-03-01' },
};

export const Invalid: Story = {
  args: { invalid: true },
};

export const Disabled: Story = {
  args: { disabled: true, value: '2024-03-15' },
};

export const NotClearable: Story = {
  args: { value: '2024-03-15', clearable: false },
};

/** 展示受控用法：value 狀態由外部 state 管理。 */
function ControlledDemo() {
  const [value, setValue] = useState<DateValue>(null);
  return <DatePicker value={value} onValueChange={setValue} defaultMonth="2024-03-01" />;
}

export const Controlled: Story = {
  render: () => <ControlledDemo />,
};
