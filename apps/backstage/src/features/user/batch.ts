import { registerBatchOperation } from '@b2b-system/web-core/batch';

import { USER_LOCALE_SCOPE } from './locale';

/** 使用者列表的批次操作 id（`BatchAction.operation`）。 */
export const UserBatchOperation = {
  ACTIVATE: 'user.activate',
  DEACTIVATE: 'user.deactivate',
  UNLOCK: 'user.unlock',
  DELETE: 'user.delete',
} as const;

/** 實作在第一次執行時才載入（docs/architecture/frontend/02-plugin-system.md §4.8）。 */
const runs = () => import('./batchRuns');

/**
 * 在 plugin 的同步階段呼叫，只登記 id 與名稱；實作在 `batchRuns.ts`。不發 toast：結果由批次佇列在整批結束時彈出
 * （docs/architecture/frontend/07-ui-system.md §13）。
 */
export function registerUserBatchOperations(): void {
  registerBatchOperation({
    id: UserBatchOperation.ACTIVATE,
    labelKey: 'user.batch.activate.title',
    localeScope: USER_LOCALE_SCOPE,
    successKey: 'user.batch.activate.success',
    run: async (userId, context) => (await runs()).updateStatusRun(userId, 'active', context),
  });
  registerBatchOperation({
    id: UserBatchOperation.DEACTIVATE,
    labelKey: 'user.batch.deactivate.title',
    localeScope: USER_LOCALE_SCOPE,
    successKey: 'user.batch.deactivate.success',
    run: async (userId, context) => (await runs()).updateStatusRun(userId, 'inactive', context),
  });
  registerBatchOperation({
    id: UserBatchOperation.UNLOCK,
    labelKey: 'user.batch.unlock.title',
    localeScope: USER_LOCALE_SCOPE,
    successKey: 'user.batch.unlock.success',
    run: async (userId, context) => (await runs()).unlockRun(userId, context),
  });
  registerBatchOperation({
    id: UserBatchOperation.DELETE,
    labelKey: 'user.batch.delete.title',
    localeScope: USER_LOCALE_SCOPE,
    successKey: 'user.batch.delete.success',
    run: async (userId, context) => (await runs()).deleteRun(userId, context),
  });
}
