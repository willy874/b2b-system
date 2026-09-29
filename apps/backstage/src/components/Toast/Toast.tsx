import { Toast as BaseToast } from '@base-ui-components/react/toast';
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

/** 各類型的預設停留時間（毫秒）：錯誤訊息通常較長、也更需要讀完，停久一點。 */
export const DEFAULT_TOAST_TIMEOUT = {
  success: 4000,
  info: 4000,
  warning: 4000,
  error: 8000,
} as const satisfies Record<ToastType, number>;

export interface ToastOptions {
  type?: ToastType;
  title: string;
  description?: string;
  /** 毫秒；`0` 表示不自動關閉。省略時用 `DEFAULT_TOAST_TIMEOUT[type]`。 */
  timeout?: number;
}

/** 在 React 樹之外也能顯示提示的控制器；由 `createToaster()` 建立，交給 `ToastProvider` 渲染。 */
export interface Toaster {
  /** 顯示一則提示，回傳 id 供 `close()` 使用。 */
  show: (options: ToastOptions) => string;
  close: (id: string) => void;
}

type ToastManager = ReturnType<typeof BaseToast.createToastManager>;

// Base UI 的 manager 不出現在公開型別上（docs/architecture/frontend/07-ui-system.md §3.1 規則 1）
const managers = new WeakMap<Toaster, ToastManager>();

export function createToaster(): Toaster {
  const manager = BaseToast.createToastManager();
  const toaster: Toaster = {
    show: ({ type = 'info', title, description, timeout = DEFAULT_TOAST_TIMEOUT[type] }) =>
      manager.add({ type, title, description, timeout }),
    close: (id) => manager.close(id),
  };
  managers.set(toaster, manager);
  return toaster;
}

function getManager(toaster: Toaster): ToastManager {
  const manager = managers.get(toaster);
  if (!manager) throw new Error('ToastProvider 的 toaster 必須由 createToaster() 建立');
  return manager;
}

/** 各層用 `classNames` / `styles` / `testIds` 覆寫（套用到每一則 toast）。 */
export type ToastSlot = 'viewport' | 'toast' | 'title' | 'description' | 'close';

interface ToastProviderProps extends SlotOverrides<ToastSlot> {
  /** 由 `createToaster()` 建立；呼叫它的 `show()` 就會出現在這個 Provider 的 viewport。 */
  toaster: Toaster;
  children: ReactNode;
}

/** Base UI 的 Toast 已內建 aria-live。 */
export function ToastProvider({
  toaster,
  children,
  classNames,
  styles: styleOverrides,
  testIds,
}: ToastProviderProps) {
  const slot = createSlots({ classNames, styles: styleOverrides, testIds });
  return (
    <BaseToast.Provider toastManager={getManager(toaster)}>
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
