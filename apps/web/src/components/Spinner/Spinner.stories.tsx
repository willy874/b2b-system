import type { Meta, StoryObj } from '@storybook/react-vite';

import { Spinner } from './Spinner';

const meta = {
  title: 'Components/Spinner',
  component: Spinner,
  args: {},
} satisfies Meta<typeof Spinner>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const CustomLabel: Story = {
  args: { label: '載入商品中', size: 32 },
};

export const Sizes: Story = {
  render: () => (
    <div className="flex items-center gap-4">
      <Spinner size={16} />
      <Spinner size={20} />
      <Spinner size={32} />
      <Spinner size={48} />
    </div>
  ),
};
