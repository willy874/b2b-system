import type { Meta, StoryObj } from '@storybook/react-vite';

import { Chip } from './Chip';

const meta = {
  title: 'Components/Chip',
  component: Chip,
  args: { children: '標籤' },
  argTypes: {
    tone: {
      control: 'inline-radio',
      options: ['neutral', 'brand', 'success', 'warning', 'danger'],
    },
  },
} satisfies Meta<typeof Chip>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const Tones: Story = {
  render: (args) => (
    <div className="flex gap-2">
      <Chip {...args} tone="neutral">
        中性
      </Chip>
      <Chip {...args} tone="brand">
        品牌
      </Chip>
      <Chip {...args} tone="success">
        成功
      </Chip>
      <Chip {...args} tone="warning">
        警告
      </Chip>
      <Chip {...args} tone="danger">
        危險
      </Chip>
    </div>
  ),
};
