import { PageHeader } from '@b2b-system/ui/PageHeader';
import { ImportWorkspace } from '@b2b-system/web-core/data-import';
import type { ImportMode } from '@b2b-system/web-core/data-transfer';
import { useTranslation } from '@b2b-system/web-core/locales';
import { RouteLink } from '@b2b-system/web-core/route-link';
import { useNavigate } from '@tanstack/react-router';
import { useMemo } from 'react';

import { PermissionKey, usePermission } from '@/core/permission';

import { groupImportApi } from '../../hooks/groupTransferApi';
import { GroupImportRoute } from '../../routes';

/** 群組匯入（docs/architecture/backend/22-data-transfer.md §12.2）：名稱、說明、持有的角色。 */
export default function GroupImportPage() {
  const { t } = useTranslation();
  const search = GroupImportRoute.useSearch();
  const navigate = useNavigate();
  const { can } = usePermission();
  // 新增模式要 group:create；修改模式要 group:update（頁面權限已保證）
  const modes = useMemo<ImportMode[]>(
    () => (can(PermissionKey['group:create']) ? ['create', 'update'] : ['update']),
    [can],
  );
  const mode = modes.includes(search.mode) ? search.mode : (modes[0] ?? 'update');

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4" data-testid="group-import-page">
      <PageHeader title={t('menu.groupImport')} />
      <ImportWorkspace
        api={groupImportApi}
        type="group"
        mode={mode}
        modes={modes}
        onModeChange={(next) => void navigate({ to: GroupImportRoute.to, search: { mode: next } })}
        transferId={search.transfer ?? null}
        onTransferChange={(transfer) =>
          void navigate({
            to: GroupImportRoute.to,
            search: { mode, ...(transfer ? { transfer } : {}) },
            // 送出之後草稿已刪、預覽已清：不再提醒未儲存
            ignoreBlocker: true,
          })
        }
        renderRecordLink={(groupId) => (
          <RouteLink
            to="group.detail"
            params={{ groupId }}
            fallback="hide"
            className="text-sm text-[var(--color-brand)]"
          >
            {t('dataTransfer.import.viewRecord')}
          </RouteLink>
        )}
      />
    </div>
  );
}
