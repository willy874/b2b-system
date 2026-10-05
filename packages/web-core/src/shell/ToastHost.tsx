import { ToastProvider, createToaster } from '@b2b-system/ui/Toast';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';

import { GlobalEvents, useAppContext } from '../app';

/**
 * 整個 app 唯一持有 toaster 的地方：把 eventBus 上的 `GlobalEvents.TOAST_SHOW` 轉成畫面上的 toast。
 * 發提示的一方（`useToast()`、plugin）只認識 eventBus，不需要知道 toast 怎麼渲染。
 */
export function ToastHost({ children }: { children: ReactNode }) {
  const { eventBus } = useAppContext();
  const [toaster] = useState(createToaster);

  useEffect(
    () =>
      eventBus.on(GlobalEvents.TOAST_SHOW, (options) => {
        toaster.show(options);
      }),
    [eventBus, toaster],
  );

  return <ToastProvider toaster={toaster}>{children}</ToastProvider>;
}
