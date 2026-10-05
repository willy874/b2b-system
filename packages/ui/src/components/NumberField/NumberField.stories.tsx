import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { fn } from 'storybook/test';

import { NumberField } from './NumberField';

const meta = {
  title: 'Components/NumberField',
  component: NumberField,
  args: { defaultValue: 1, onValueChange: fn() },
  argTypes: {
    size: { control: 'inline-radio', options: ['sm', 'md'] },
  },
} satisfies Meta<typeof NumberField>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const Sizes: Story = {
  render: (args) => (
    <div className="flex items-center gap-2">
      <NumberField {...args} size="sm" />
      <NumberField {...args} size="md" />
    </div>
  ),
};

export const MinMaxStep: Story = {
  args: { min: 0, max: 10, step: 2, defaultValue: 4 },
};

export const Invalid: Story = {
  args: { invalid: true },
};

export const Disabled: Story = {
  args: { disabled: true },
};

export const ReadOnly: Story = {
  args: { readOnly: true },
};

function ControlledDemo() {
  const [value, setValue] = useState<number | null>(3);
  return <NumberField value={value} onValueChange={setValue} min={0} max={20} />;
}

export const Controlled: Story = {
  render: () => <ControlledDemo />,
};
