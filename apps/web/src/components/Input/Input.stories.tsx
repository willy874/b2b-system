import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';

import { Input, Textarea } from './Input';

const meta = {
  title: 'Components/Input',
  component: Input,
  args: {
    'aria-label': '專案名稱',
    placeholder: '請輸入專案名稱',
    onChange: fn(),
  },
  argTypes: {
    size: { control: 'inline-radio', options: ['sm', 'md'] },
  },
} satisfies Meta<typeof Input>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const Sizes: Story = {
  render: (args) => (
    <div className="flex flex-col gap-2">
      <Input {...args} size="sm" />
      <Input {...args} size="md" />
    </div>
  ),
};

export const Invalid: Story = {
  args: { invalid: true, defaultValue: '不合法的值' },
};

export const Disabled: Story = {
  args: { disabled: true, defaultValue: '無法編輯' },
};

export const WithTextarea: Story = {
  render: () => <Textarea aria-label="專案描述" placeholder="請輸入描述" rows={4} />,
};
