import type { ToastOptions, ToastType } from '@b2b-system/ui/Toast';
import { useMemo } from 'react';

import { GlobalEvents, useAppContext } from '../app';

export interface ToastApi {
  success: (title: string, description?: string) => void;
  error: (title: string, description?: string) => void;
  warning: (title: string, description?: string) => void;
  info: (title: string, description?: string) => void;
  /** 完整選項，例如附上動作鈕：`show({ type: 'success', title, action: { label, onClick } })`。 */
  show: (options: ToastOptions) => void;
}

/**
 * 顯示提示：把 `GlobalEvents.TOAST_SHOW` 發到 eventBus，由 `shell/ToastHost` 渲染。
 * 呼叫端不需要在 ToastProvider 底下；React 之外的程式碼（plugin、攔截器）直接
 * `eventBus.emit(GlobalEvents.TOAST_SHOW, options)`。
 */
export function useToast(): ToastApi {
  const { eventBus } = useAppContext();
  return useMemo<ToastApi>(() => {
    const show = (type: ToastType) => (title: string, description?: string) => {
      eventBus.emit(GlobalEvents.TOAST_SHOW, { type, title, description });
    };
    return {
      success: show('success'),
      error: show('error'),
      warning: show('warning'),
      info: show('info'),
      show: (options) => eventBus.emit(GlobalEvents.TOAST_SHOW, options),
    };
  }, [eventBus]);
}
