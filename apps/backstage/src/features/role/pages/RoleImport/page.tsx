import { ImportWorkspace } from '@b2b-system/web-core/data-import';
import type { ImportMode } from '@b2b-system/web-core/data-transfer';
import { useTranslation } from '@b2b-system/web-core/locales';
import { RouteLink } from '@b2b-system/web-core/route-link';
import { useNavigate } from '@tanstack/react-router';
import { useMemo } from 'react';

import { PermissionKey, usePermission } from '@/core/permission';

import { roleImportApi } from '../../hooks/roleTransferApi';
import { RoleImportRoute } from '../../routes';

/** 角色匯入（docs/architecture/backend/22-data-transfer.md §12.1）：把 fetcher 與 `type: 'role'` 交給 web-core 的匯入工作區。 */
export default function RoleImportPage() {
  const { t } = useTranslation();
  const search = RoleImportRoute.useSearch();
  const navigate = useNavigate();
  const { can } = usePermission();
  // 新增模式要 role:create；修改模式要 role:update（頁面權限已保證）
  const modes = useMemo<ImportMode[]>(
    () => (can(PermissionKey['role:create']) ? ['create', 'update'] : ['update']),
    [can],
  );
  const mode = modes.includes(search.mode) ? search.mode : (modes[0] ?? 'update');

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4" data-testid="role-import-page">
      <header>
        <h1 className="m-0 text-xl font-semibold">{t('menu.roleImport')}</h1>
      </header>
      <ImportWorkspace
        api={roleImportApi}
        type="role"
        mode={mode}
        modes={modes}
        onModeChange={(next) => void navigate({ to: RoleImportRoute.to, search: { mode: next } })}
        transferId={search.transfer ?? null}
        onTransferChange={(transfer) =>
          void navigate({
            to: RoleImportRoute.to,
            search: { mode, ...(transfer ? { transfer } : {}) },
            // 送出之後草稿已刪、預覽已清：不再提醒未儲存
            ignoreBlocker: true,
          })
        }
        renderRecordLink={(roleId) => (
          <RouteLink
            to="role.detail"
            params={{ roleId }}
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
