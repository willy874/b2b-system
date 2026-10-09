import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { ImageCropper } from './ImageCropper';
import type { ImageCrop } from './ImageCropper';

const meta = {
  title: 'Components/ImageCropper',
  component: ImageCropper,
  args: {
    src: 'https://picsum.photos/id/1025/800/533',
    alt: '示意圖',
    naturalWidth: 800,
    naturalHeight: 533,
  },
} satisfies Meta<typeof ImageCropper>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Free: Story = {};

/** 固定 1:1、圓形參考線、最小 128 px（例：頭像）。 */
export const Square: Story = {
  args: { aspectRatio: 1, shape: 'circle', minWidth: 128, minHeight: 128 },
};

/** 受控：輸出以比例（0～1）表示的範圍。 */
export const Controlled: Story = {
  render: (args) => {
    const [crop, setCrop] = useState<ImageCrop>();
    return (
      <div className="flex flex-col gap-2">
        <ImageCropper {...args} aspectRatio={16 / 9} value={crop} onValueChange={setCrop} />
        <code>{JSON.stringify(crop)}</code>
      </div>
    );
  },
};
