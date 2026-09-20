import { Toast as BaseToast } from '@base-ui-components/react/toast';
import { useMemo } from 'react';
import type { ReactNode } from 'react';

import { cn } from '@/shared/utils';

import './Toast.css';

export function ToastProvider({ children }: { children: ReactNode }) {
  return (
    <BaseToast.Provider>
      {children}
      <BaseToast.Portal>
        <BaseToast.Viewport className="ge-toast__viewport">
          <ToastList />
        </BaseToast.Viewport>
      </BaseToast.Portal>
    </BaseToast.Provider>
  );
}

function ToastList() {
  const { toasts } = BaseToast.useToastManager();
  return (
    <>
      {toasts.map((toast) => (
        <BaseToast.Root
          key={toast.id}
          toast={toast}
          className={cn('ge-toast', `ge-toast--${String(toast.type ?? 'info')}`)}
          data-testid={`toast-${String(toast.type ?? 'info')}`}
        >
          <BaseToast.Title className="ge-toast__title" />
          <BaseToast.Description className="ge-toast__description" />
          <BaseToast.Close className="ge-toast__close" aria-label="close" data-testid="toast-close">
            ✕
          </BaseToast.Close>
        </BaseToast.Root>
      ))}
    </>
  );
}

export interface ToastApi {
  success: (message: string, description?: string) => void;
  error: (message: string, description?: string) => void;
  warning: (message: string, description?: string) => void;
  info: (message: string, description?: string) => void;
}

/** Base UI 的 Toast 已內建 aria-live。 */
export function useToast(): ToastApi {
  const manager = BaseToast.useToastManager();
  return useMemo<ToastApi>(() => {
    const add = (type: string) => (message: string, description?: string) => {
      manager.add({ title: message, description, type, timeout: type === 'error' ? 8000 : 4000 });
    };
    return {
      success: add('success'),
      error: add('error'),
      warning: add('warning'),
      info: add('info'),
    };
  }, [manager]);
}
