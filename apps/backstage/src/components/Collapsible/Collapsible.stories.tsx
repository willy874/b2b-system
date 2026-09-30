import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { fn } from 'storybook/test';

import { Collapsible } from './Collapsible';

const meta = {
  title: 'Components/Collapsible',
  component: Collapsible,
  args: {
    title: '更多設定',
    children: '這裡是收合面板裡的內容，可以放入任意元素。',
    onOpenChange: fn(),
  },
} satisfies Meta<typeof Collapsible>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const DefaultOpen: Story = {
  args: { defaultOpen: true },
};

export const Disabled: Story = {
  args: { disabled: true },
};

/** 展示受控用法：open 狀態由外部 state 管理。 */
function ControlledDemo() {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible title="更多設定" open={open} onOpenChange={setOpen}>
      這裡是收合面板裡的內容，可以放入任意元素。
    </Collapsible>
  );
}

export const Controlled: Story = {
  render: () => <ControlledDemo />,
};
