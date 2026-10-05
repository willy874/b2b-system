import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { Button } from '../Button';
import { ConfirmDialogProvider, useConfirm } from './ConfirmDialog';
import type { ConfirmOptions } from './ConfirmDialog';

const meta = {
  title: 'Components/ConfirmDialog',
  component: ConfirmDialogProvider,
  parameters: {
    // 開啟狀態的彈出層會蓋住整個 docs 頁；每個 story 放進自己的 iframe
    docs: { story: { inline: false, iframeHeight: 360 } },
  },
  args: {
    confirmLabel: '確認',
    cancelLabel: '取消',
    children: null,
  },
} satisfies Meta<typeof ConfirmDialogProvider>;

export default meta;
type Story = StoryObj<typeof meta>;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** 按下按鈕呼叫 `confirm()`，把回傳值顯示在旁邊。 */
function ConfirmDemo({ label, options }: { label: string; options: ConfirmOptions }) {
  const confirm = useConfirm();
  const [result, setResult] = useState<string>('尚未回答');
  return (
    <div className="flex items-center gap-3">
      <Button
        variant={options.tone === 'primary' ? 'primary' : 'danger'}
        onClick={async () => setResult(String(await confirm(options)))}
      >
        {label}
      </Button>
      <span>回傳：{result}</span>
    </div>
  );
}

export const Playground: Story = {
  render: (args) => (
    <ConfirmDialogProvider {...args}>
      <ConfirmDemo
        label="刪除項目"
        options={{
          title: '刪除這個項目？',
          description: '刪除後無法復原，請確認是否繼續。',
          confirmLabel: '刪除',
        }}
      />
    </ConfirmDialogProvider>
  ),
};

export const Primary: Story = {
  render: (args) => (
    <ConfirmDialogProvider {...args}>
      <ConfirmDemo
        label="送出表單"
        options={{ tone: 'primary', title: '送出這份表單？', confirmLabel: '送出' }}
      />
    </ConfirmDialogProvider>
  ),
};

/** `onConfirm` 執行期間按鈕呈 loading，完成後才關閉並回傳 `true`。 */
export const AsyncAction: Story = {
  render: (args) => (
    <ConfirmDialogProvider {...args}>
      <ConfirmDemo
        label="刪除項目（1.5 秒）"
        options={{
          title: '刪除這個項目？',
          confirmLabel: '刪除',
          onConfirm: () => wait(1500),
        }}
      />
    </ConfirmDialogProvider>
  ),
};

/** `onConfirm` 丟錯時對話框留著，使用者可以重試或取消。 */
export const ActionFails: Story = {
  render: (args) => (
    <ConfirmDialogProvider {...args}>
      <ConfirmDemo
        label="刪除項目（會失敗）"
        options={{
          title: '刪除這個項目？',
          confirmLabel: '刪除',
          onConfirm: async () => {
            await wait(800);
            throw new Error('失敗');
          },
        }}
      />
    </ConfirmDialogProvider>
  ),
};
