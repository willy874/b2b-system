import { useMemo } from 'react';

import type { ToastType } from '@/components/Toast';
import { GlobalEvents, useAppContext } from '@/core/app';

export interface ToastApi {
  success: (title: string, description?: string) => void;
  error: (title: string, description?: string) => void;
  warning: (title: string, description?: string) => void;
  info: (title: string, description?: string) => void;
}

/**
 * 顯示提示：把 `GlobalEvents.TOAST_SHOW` 發到 eventBus，由 `app/ToastHost` 渲染。
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
    };
  }, [eventBus]);
}
