import type { ToastOptions } from '@/components/Toast';

/** 跨 feature 的事件名稱。feature 內的事件放 `features/<name>/enums/events.ts`。 */
export const GlobalEvents = {
  SESSION_ENDED: 'session:ended',
  PERMISSIONS_CHANGED: 'permissions:changed',
  USER_ROLES_CHANGED: 'user:rolesChanged',
  /** 顯示一則 toast；由 `app/ToastHost` 接手渲染。React 裡用 `useToast()`（`core/notify`）。 */
  TOAST_SHOW: 'toast:show',
} as const;

/** 全域 eventBus（`eventBusPlugin`）上的事件與 payload。 */
export type GlobalEventMap = {
  [GlobalEvents.USER_ROLES_CHANGED]: (payload: { userId: string }) => void;
  [GlobalEvents.SESSION_ENDED]: (reason: string) => void;
  [GlobalEvents.TOAST_SHOW]: (options: ToastOptions) => void;
};
