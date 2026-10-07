import type { BatchAction } from '@b2b-system/web-core/batch';
import { useTranslation } from '@b2b-system/web-core/locales';
import { useMemo } from 'react';

import { UserBatchOperation } from '../../batch';
import { useUserPermission } from '../../hooks/useUserPermission';
import type { UserRowVM } from './adapter';

/**
 * 使用者列表的批次動作：確認後送進全域佇列，逐筆呼叫單筆 API（docs/architecture/frontend/07-ui-system.md §13）。
 * 資格沿用 adapter 算好的列旗標：
 * 不能動自己（`canUpdate` / `canDelete` 已排除），解鎖只對被鎖定的人。
 */
export function useUserBatchActions(): Array<BatchAction<UserRowVM>> {
  const { t } = useTranslation();
  const permission = useUserPermission();
  // 權限未水合前不出現操作按鈕（docs/coding-standards/02-frontend.md §3.2）
  const ready = permission.hydrated;

  return useMemo(
    () => [
      {
        id: 'activate',
        label: t('user.batch.activate.action'),
        tone: 'success',
        hidden: !ready || !permission.canUpdate,
        isEligible: (row) => row.canUpdate && row.status === 'inactive',
        ineligibleReason: t('user.batch.activate.ineligible'),
        confirm: ({ eligible }) => ({
          title: t('user.batch.activate.title'),
          description: t('user.batch.activate.confirm', { count: eligible.length }),
        }),
        operation: UserBatchOperation.ACTIVATE,
      },
      {
        id: 'deactivate',
        label: t('user.batch.deactivate.action'),
        tone: 'warning',
        hidden: !ready || !permission.canUpdate,
        isEligible: (row) => row.canUpdate && row.status !== 'inactive',
        ineligibleReason: t('user.batch.deactivate.ineligible'),
        confirm: ({ eligible }) => ({
          title: t('user.batch.deactivate.title'),
          description: t('user.batch.deactivate.confirm', { count: eligible.length }),
        }),
        operation: UserBatchOperation.DEACTIVATE,
      },
      {
        id: 'unlock',
        label: t('user.batch.unlock.action'),
        tone: 'success',
        hidden: !ready || !permission.canUnlock,
        isEligible: (row) => row.canUnlock,
        ineligibleReason: t('user.batch.unlock.ineligible'),
        confirm: ({ eligible }) => ({
          title: t('user.batch.unlock.title'),
          description: t('user.batch.unlock.confirm', { count: eligible.length }),
        }),
        operation: UserBatchOperation.UNLOCK,
      },
      {
        id: 'delete',
        label: t('user.batch.delete.action'),
        tone: 'danger',
        hidden: !ready || !permission.canDelete,
        isEligible: (row) => row.canDelete,
        ineligibleReason: t('user.batch.delete.ineligible'),
        confirm: ({ eligible }) => ({
          title: t('user.batch.delete.title'),
          description: t('user.batch.delete.confirm', { count: eligible.length }),
        }),
        operation: UserBatchOperation.DELETE,
      },
    ],
    [permission, ready, t],
  );
}
