import type { Meta, StoryObj } from '@storybook/react-vite';

import { Button } from '../Button';
import { createToaster, ToastProvider } from './Toast';
import type { ToastType } from './Toast';

const TOAST_SAMPLES: Record<ToastType, { title: string; description: string }> = {
  success: { title: '商品已建立', description: '「藍牙耳機」已加入商品清單。' },
  error: { title: '儲存失敗', description: '庫存數量不可小於 0，請重新輸入。' },
  warning: { title: '庫存偏低', description: '「藍牙耳機」剩餘 3 件，建議盡快補貨。' },
  info: { title: '同步完成', description: '商品資料已與倉儲系統同步。' },
};

/** 在元件樹外建立的控制器；`show()` 顯示的提示會出現在同一個 `toaster` 對應的 `ToastProvider`。 */
const toaster = createToaster();

const meta = {
  title: 'Components/Toast',
  component: ToastProvider,
  // 各 story 以 render 自行組裝；這裡只滿足必填 props 的型別
  args: { toaster, children: null },
} satisfies Meta<typeof ToastProvider>;

export default meta;
type Story = StoryObj<typeof meta>;

function ToastDemo() {
  return (
    <ToastProvider toaster={toaster}>
      <div className="flex gap-2">
        {(Object.keys(TOAST_SAMPLES) as ToastType[]).map((type) => (
          <Button
            key={type}
            variant="secondary"
            onClick={() => toaster.show({ type, ...TOAST_SAMPLES[type] })}
          >
            {type}
          </Button>
        ))}
      </div>
    </ToastProvider>
  );
}

export const Playground: Story = {
  render: () => <ToastDemo />,
};

function PersistentDemo() {
  return (
    <ToastProvider toaster={toaster}>
      <Button
        variant="primary"
        onClick={() => toaster.show({ type: 'info', title: '上傳中', timeout: 0 })}
      >
        顯示不會自動關閉的提示
      </Button>
    </ToastProvider>
  );
}

/** `timeout: 0` 表示不自動關閉，需要手動按關閉鈕（或呼叫 `toaster.close(id)`）。 */
export const Persistent: Story = {
  render: () => <PersistentDemo />,
};
