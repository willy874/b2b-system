import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';

import { Button } from '../Button';
import { Popover } from './Popover';

const meta = {
  title: 'Components/Popover',
  component: Popover,
  args: {
    trigger: <Button>開啟</Button>,
    children: '這裡是彈層內容。',
    onOpenChange: fn(),
  },
  argTypes: {
    side: { control: 'inline-radio', options: ['top', 'bottom', 'left', 'right'] },
    align: { control: 'inline-radio', options: ['start', 'center', 'end'] },
  },
} satisfies Meta<typeof Popover>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const WithTitleAndDescription: Story = {
  args: {
    title: '刪除項目',
    description: '刪除後無法復原，確定要繼續嗎？',
  },
};

export const DefaultOpen: Story = {
  args: { defaultOpen: true },
};
