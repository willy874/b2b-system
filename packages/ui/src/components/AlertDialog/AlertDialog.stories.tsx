import type { Meta, StoryObj } from '@storybook/react-vite';
import { useArgs } from 'storybook/preview-api';
import { fn } from 'storybook/test';

import { Button } from '../Button';
import { AlertDialog } from './AlertDialog';

const meta = {
  title: 'Components/AlertDialog',
  component: AlertDialog,
  parameters: {
    // 開啟狀態的彈出層會蓋住整個 docs 頁；每個 story 放進自己的 iframe
    docs: { story: { inline: false, iframeHeight: 360 } },
  },
  args: {
    open: true,
    onOpenChange: fn(),
    title: '刪除這個項目？',
    description: '刪除後無法復原，請確認是否繼續。',
    confirmLabel: '刪除',
    cancelLabel: '取消',
    onConfirm: fn(),
  },
  /**
   * `open` 是受控的必填 prop：關閉、確認時把新狀態寫回 args，否則對話框永遠關不掉；
   * 關掉後用按鈕（或 Controls 的 open）重新開啟。`useArgs` 只能在 render 函式本身呼叫。
   */
  render: function Render(args) {
    const [, updateArgs] = useArgs();
    const setOpen = (open: boolean) => {
      args.onOpenChange(open);
      updateArgs({ open });
    };
    return (
      <>
        <Button variant="danger" onClick={() => setOpen(true)}>
          開啟確認對話框
        </Button>
        <AlertDialog
          {...args}
          onOpenChange={setOpen}
          onConfirm={() => {
            void args.onConfirm();
            setOpen(false);
          }}
        />
      </>
    );
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
