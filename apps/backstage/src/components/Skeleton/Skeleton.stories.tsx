import type { Meta, StoryObj } from '@storybook/react-vite';

import { Skeleton } from './Skeleton';

const meta = {
  title: 'Components/Skeleton',
  component: Skeleton,
} satisfies Meta<typeof Skeleton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  args: { width: 200, height: 16 },
};

export const Rounded: Story = {
  args: { width: 48, height: 48, rounded: true },
};

export const TextLines: Story = {
  render: () => (
    <div className="flex flex-col gap-2" style={{ width: '16rem' }}>
      <Skeleton width="100%" height={14} />
      <Skeleton width="80%" height={14} />
      <Skeleton width="60%" height={14} />
    </div>
  ),
};

export const CardPlaceholder: Story = {
  render: () => (
    <div className="flex items-center gap-3">
      <Skeleton width={40} height={40} rounded />
      <div className="flex flex-col gap-2">
        <Skeleton width={120} height={12} />
        <Skeleton width={80} height={12} />
      </div>
    </div>
  ),
};
