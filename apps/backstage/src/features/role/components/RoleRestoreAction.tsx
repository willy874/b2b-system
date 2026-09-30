import { Button } from '@/components/Button';
import { useTranslation } from '@/core/locales';
import type { TrashRestoreActionProps } from '@/core/trash';

import { useRoleRestoreMutation } from '../hooks/useRoleMutations';

/** 回收桶「角色」分頁每一列的還原按鈕（登記在 `trash.ts`）。 */
export function RoleRestoreAction({ item }: TrashRestoreActionProps) {
  const { t } = useTranslation();
  const restore = useRoleRestoreMutation();
  return (
    <Button
      size="sm"
      loading={restore.isPending}
      onClick={() => restore.mutate({ params: { roleId: item.id } })}
      data-testid="role-restore"
      data-value={item.id}
    >
      {t('role.restore.action')}
    </Button>
  );
}
