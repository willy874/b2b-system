import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { fn } from 'storybook/test';

import { Button } from '../Button';
import { Dialog } from './Dialog';

const meta = {
  title: 'Components/Dialog',
  component: Dialog,
  args: {
    title: '建立專案',
    children: <p>這裡放表單或說明文字。</p>,
    onOpenChange: fn(),
  },
  argTypes: {
    size: { control: 'inline-radio', options: ['sm', 'md', 'lg'] },
  },
} satisfies Meta<typeof Dialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  args: { defaultOpen: true },
};

export const WithDescriptionAndFooter: Story = {
  args: {
    defaultOpen: true,
    description: '這個操作會建立一個新專案，稍後仍可以修改設定。',
    footer: (
      <>
        <Button variant="ghost">取消</Button>
        <Button variant="primary">確認建立</Button>
      </>
    ),
  },
};

/** 三種尺寸各自用一顆按鈕觸發，避免三個對話框同時疊在畫面上。 */
function SizesDemo() {
  const [openSize, setOpenSize] = useState<'sm' | 'md' | 'lg' | null>(null);
  return (
    <div className="flex gap-2">
      <Button onClick={() => setOpenSize('sm')}>小尺寸</Button>
      <Button onClick={() => setOpenSize('md')}>中尺寸</Button>
      <Button onClick={() => setOpenSize('lg')}>大尺寸</Button>
      <Dialog
        open={openSize !== null}
        onOpenChange={(next) => setOpenSize(next ? openSize : null)}
        size={openSize ?? 'md'}
        title="建立專案"
      >
        <p>內容</p>
      </Dialog>
    </div>
  );
}

export const Sizes: Story = {
  render: () => <SizesDemo />,
};

export const NotDismissible: Story = {
  args: {
    defaultOpen: true,
    dismissible: false,
    description: '點擊遮罩不會關閉，破壞性操作可以用這個設定。',
  },
};

/** 受控使用：外部按鈕控制開關狀態。 */
function ControlledDemo() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>開啟對話框</Button>
      <Dialog open={open} onOpenChange={setOpen} title="建立專案" description="受控的開關狀態">
        <p>內容</p>
      </Dialog>
    </>
  );
}

export const Controlled: Story = {
  render: () => <ControlledDemo />,
};
