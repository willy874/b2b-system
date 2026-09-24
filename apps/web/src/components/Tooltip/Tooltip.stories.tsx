import type { Meta, StoryObj } from '@storybook/react-vite';

import { Button } from '../Button';
import { Tooltip, TooltipProvider } from './Tooltip';

const meta = {
  title: 'Components/Tooltip',
  component: Tooltip,
  args: {
    content: '內建項目不可刪除',
    children: <Button>刪除</Button>,
  },
  decorators: [
    (Story) => (
      <TooltipProvider>
        <Story />
      </TooltipProvider>
    ),
  ],
} satisfies Meta<typeof Tooltip>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const Sides: Story = {
  render: () => (
    <div className="flex gap-8">
      <Tooltip content="上方提示" side="top">
        <Button>上</Button>
      </Tooltip>
      <Tooltip content="下方提示" side="bottom">
        <Button>下</Button>
      </Tooltip>
      <Tooltip content="左側提示" side="left">
        <Button>左</Button>
      </Tooltip>
      <Tooltip content="右側提示" side="right">
        <Button>右</Button>
      </Tooltip>
    </div>
  ),
};

/** 內容為空時直接渲染 children，不包一層提示框。 */
export const EmptyContent: Story = {
  args: { content: '' },
};

/**
 * 這個元件沒有透出「預設開啟」的 prop（Base UI 的 `defaultOpen` 只在 `Tooltip.Root` 上，
 * 我們的 `Tooltip` 沒有轉發）；改示範 `TooltipProvider` 的 `delay={0}`，群組內的提示會立刻顯示。
 */
export const InstantDelay: Story = {
  decorators: [
    (Story) => (
      <TooltipProvider delay={0}>
        <Story />
      </TooltipProvider>
    ),
  ],
};
