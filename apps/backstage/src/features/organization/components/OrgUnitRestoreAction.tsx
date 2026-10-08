import { Button } from '@b2b-system/ui/Button';
import { useTranslation } from '@b2b-system/web-core/locales';

import type { TrashRestoreActionProps } from '@/core/trash';

import { useOrgUnitRestoreMutation } from '../hooks/useOrgUnitMutations';

/** 回收桶「部門」分頁每一列的還原按鈕（登記在 `trash.ts`）。 */
export function OrgUnitRestoreAction({ item }: TrashRestoreActionProps) {
  const { t } = useTranslation();
  const restore = useOrgUnitRestoreMutation();
  return (
    <Button
      size="sm"
      loading={restore.isPending}
      onClick={() => restore.mutate({ params: { unitId: item.id } })}
      data-testid="org-unit-restore"
      data-value={item.id}
    >
      {t('organization.restore.action')}
    </Button>
  );
}
