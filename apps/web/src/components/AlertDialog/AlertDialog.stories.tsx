import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { fn } from 'storybook/test';

import { Button } from '../Button';
import { AlertDialog } from './AlertDialog';

const meta = {
  title: 'Components/AlertDialog',
  component: AlertDialog,
  args: {
    open: true,
    onOpenChange: fn(),
    title: '刪除這個項目？',
    description: '刪除後無法復原，請確認是否繼續。',
    confirmLabel: '刪除',
    cancelLabel: '取消',
    onConfirm: fn(),
  },
} satisfies Meta<typeof AlertDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const Primary: Story = {
  args: { tone: 'primary', title: '送出這份表單？', confirmLabel: '送出' },
};

export const Loading: Story = {
  args: { loading: true },
};

/** 破壞性確認需要觸發按鈕才能在畫面上開關，因此獨立用受控範例展示。 */
function ControlledDemo() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="danger" onClick={() => setOpen(true)}>
        刪除項目
      </Button>
      <AlertDialog
        open={open}
        onOpenChange={setOpen}
        title="刪除這個項目？"
        description="刪除後無法復原，請確認是否繼續。"
        confirmLabel="刪除"
        cancelLabel="取消"
        onConfirm={() => setOpen(false)}
      />
    </>
  );
}

export const WithTrigger: Story = {
  render: () => <ControlledDemo />,
};
