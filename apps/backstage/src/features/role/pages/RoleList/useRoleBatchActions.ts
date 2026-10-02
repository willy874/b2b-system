import { useMemo } from 'react';

import type { BatchAction } from '@/core/batch';
import { useTranslation } from '@/core/locales';

import { RoleBatchOperation } from '../../batch';
import { useRolePermission } from '../../hooks/useRolePermission';
import type { RoleRowVM } from './adapter';

/**
 * 角色列表的批次動作（docs/architecture/frontend/07-ui-system.md §13）。系統角色與仍有人持有的角色不送出——
 * 批次刪除不提供強制刪除，要強制請走單筆。
 */
export function useRoleBatchActions(): Array<BatchAction<RoleRowVM>> {
  const { t } = useTranslation();
  const permission = useRolePermission();

  return useMemo(
    () => [
      {
        id: 'delete',
        label: t('role.batch.delete.action'),
        tone: 'danger',
        // 權限未水合前不出現操作按鈕（docs/conventions/02-frontend.md §3.2）
        hidden: !permission.hydrated || !permission.canDelete,
        isEligible: (row) => row.canDelete && row.userCount === 0,
        ineligibleReason: t('role.batch.delete.ineligible'),
        confirm: ({ eligible }) => ({
          title: t('role.batch.delete.title'),
          description: t('role.batch.delete.confirm', { count: eligible.length }),
        }),
        operation: RoleBatchOperation.DELETE,
      },
    ],
    [permission, t],
  );
}
