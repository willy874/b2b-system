import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { fn } from 'storybook/test';

import type { DateRange } from './DateRangePicker';
import { DateRangePicker } from './DateRangePicker';

const meta = {
  title: 'Components/DatePicker/DateRangePicker',
  component: DateRangePicker,
  args: { value: { from: null, to: null }, onValueChange: fn() },
} satisfies Meta<typeof DateRangePicker>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const WithValue: Story = {
  args: { value: { from: '2024-03-05', to: '2024-03-18' } },
};

export const PartialSelection: Story = {
  args: { value: { from: '2024-03-05', to: null } },
};

export const WithMinMax: Story = {
  args: { min: '2024-03-01', max: '2024-03-25', defaultMonth: '2024-03-01' },
};

export const Disabled: Story = {
  args: { disabled: true, value: { from: '2024-03-05', to: '2024-03-18' } },
};

/** 展示受控用法：value 狀態由外部 state 管理，兩段式選取起訖日。 */
function ControlledDemo() {
  const [value, setValue] = useState<DateRange>({ from: null, to: null });
  return <DateRangePicker value={value} onValueChange={setValue} defaultMonth="2024-03-01" />;
}

export const Controlled: Story = {
  render: () => <ControlledDemo />,
};
