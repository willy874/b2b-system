import { useMemo } from 'react';

import type { BatchAction } from '@/core/batch';
import { useTranslation } from '@/core/locales';

import {
  useUserBatchDeleteMutation,
  useUserBatchStatusMutation,
  useUserBatchUnlockMutation,
} from '../../hooks/useUserMutations';
import { useUserPermission } from '../../hooks/useUserPermission';
import type { UserRowVM } from './adapter';

/**
 * 使用者列表的批次動作（ADR-0009 D14）。資格沿用 adapter 算好的列旗標：
 * 不能動自己（`canUpdate` / `canDelete` 已排除），解鎖只對被鎖定的人。
 */
export function useUserBatchActions(): Array<BatchAction<UserRowVM>> {
  const { t } = useTranslation();
  const permission = useUserPermission();
  const { mutateAsync: deleteMany } = useUserBatchDeleteMutation();
  const { mutateAsync: unlockMany } = useUserBatchUnlockMutation();
  const { mutateAsync: updateStatusMany } = useUserBatchStatusMutation();
  // 權限未水合前不出現操作按鈕（docs/conventions/02-frontend.md §3.2）
  const ready = permission.hydrated;

  return useMemo(
    () => [
      {
        id: 'activate',
        label: t('user.batch.activate.action'),
        hidden: !ready || !permission.canUpdate,
        isEligible: (row) => row.canUpdate && row.status === 'inactive',
        confirm: ({ eligible }) => ({
          title: t('user.batch.activate.title'),
          description: t('user.batch.activate.confirm', { count: eligible.length }),
        }),
        run: (ids) => updateStatusMany({ params: { body: { ids, status: 'active' } } }),
        successMessage: (count) => t('user.batch.activate.success', { count }),
      },
      {
        id: 'deactivate',
        label: t('user.batch.deactivate.action'),
        tone: 'danger',
        hidden: !ready || !permission.canUpdate,
        isEligible: (row) => row.canUpdate && row.status !== 'inactive',
        confirm: ({ eligible }) => ({
          title: t('user.batch.deactivate.title'),
          description: t('user.batch.deactivate.confirm', { count: eligible.length }),
        }),
        run: (ids) => updateStatusMany({ params: { body: { ids, status: 'inactive' } } }),
        successMessage: (count) => t('user.batch.deactivate.success', { count }),
      },
      {
        id: 'unlock',
        label: t('user.batch.unlock.action'),
        hidden: !ready || !permission.canUnlock,
        isEligible: (row) => row.canUnlock,
        confirm: ({ eligible }) => ({
          title: t('user.batch.unlock.title'),
          description: t('user.batch.unlock.confirm', { count: eligible.length }),
        }),
        run: (ids) => unlockMany({ params: { body: { ids } } }),
        successMessage: (count) => t('user.batch.unlock.success', { count }),
      },
      {
        id: 'delete',
        label: t('user.batch.delete.action'),
        tone: 'danger',
        hidden: !ready || !permission.canDelete,
        isEligible: (row) => row.canDelete,
        confirm: ({ eligible }) => ({
          title: t('user.batch.delete.title'),
          description: t('user.batch.delete.confirm', { count: eligible.length }),
        }),
        run: (ids) => deleteMany({ params: { body: { ids } } }),
        successMessage: (count) => t('user.batch.delete.success', { count }),
      },
    ],
    [deleteMany, permission, ready, t, unlockMany, updateStatusMany],
  );
}
