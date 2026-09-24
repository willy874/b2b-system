import { Toast as BaseToast } from '@base-ui-components/react/toast';
import { useMemo } from 'react';
import type { ReactNode } from 'react';

import { createSlots } from '../slots';
import type { SlotOverrides, SlotResolver } from '../slots';

import styles from './Toast.module.css';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

const TOAST_TYPES: readonly string[] = [
  'success',
  'error',
  'warning',
  'info',
] satisfies ToastType[];

/** Base UI 的 `toast.type` 是任意字串；不在值域內的一律視為 `info`。 */
function toToastType(type: string | undefined): ToastType {
  return type !== undefined && TOAST_TYPES.includes(type) ? (type as ToastType) : 'info';
}

/** 各層用 `classNames` / `styles` / `testIds` 覆寫（套用到每一則 toast）。 */
export type ToastSlot = 'viewport' | 'toast' | 'title' | 'description' | 'close';

interface ToastProviderProps extends SlotOverrides<ToastSlot> {
  children: ReactNode;
}

export function ToastProvider({
  children,
  classNames,
  styles: styleOverrides,
  testIds,
}: ToastProviderProps) {
  const slot = createSlots({ classNames, styles: styleOverrides, testIds });
  return (
    <BaseToast.Provider>
      {children}
      <BaseToast.Portal>
        <BaseToast.Viewport {...slot('viewport', styles.viewport)}>
          <ToastList slot={slot} />
        </BaseToast.Viewport>
      </BaseToast.Portal>
    </BaseToast.Provider>
  );
}

function ToastList({ slot }: { slot: SlotResolver<ToastSlot> }) {
  const { toasts } = BaseToast.useToastManager();
  return (
    <>
      {toasts.map((toast) => {
        const type = toToastType(toast.type);
        return (
          <BaseToast.Root
            key={toast.id}
            toast={toast}
            {...slot('toast', styles.toast, { testId: 'toast' })}
            data-value={type}
          >
            <BaseToast.Title {...slot('title', styles.title)} />
            <BaseToast.Description {...slot('description', styles.description)} />
            <BaseToast.Close
              {...slot('close', styles.close, { testId: 'toast-close' })}
              aria-label="close"
            >
              ✕
            </BaseToast.Close>
          </BaseToast.Root>
        );
      })}
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
    const add = (type: ToastType) => (message: string, description?: string) => {
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
