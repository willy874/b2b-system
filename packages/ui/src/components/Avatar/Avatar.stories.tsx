import type { Meta, StoryObj } from '@storybook/react-vite';

import { Avatar } from './Avatar';

const meta = {
  title: 'Components/Avatar',
  component: Avatar,
  args: { name: '王小明' },
} satisfies Meta<typeof Avatar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const WithImage: Story = {
  args: { src: 'https://i.pravatar.cc/64?img=12' },
};

/** 呼叫端渲染的圖片（例：web-core 的 `SignedImage`）疊在縮寫上；這裡用一般的 `<picture>` 示意。 */
export const WithCustomImage: Story = {
  args: {
    image: (
      <picture>
        <img alt="王小明" src="https://i.pravatar.cc/128?img=12" />
      </picture>
    ),
  },
};

export const Sizes: Story = {
  render: (args) => (
    <div className="flex items-center gap-2">
      <Avatar {...args} size={24} />
      <Avatar {...args} size={32} />
      <Avatar {...args} size={48} />
      <Avatar {...args} size={64} />
    </div>
  ),
};

export const SingleWordName: Story = {
  args: { name: '小明' },
};
