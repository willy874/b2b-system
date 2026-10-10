import { PageHeader } from '@b2b-system/ui/PageHeader';
import { ImportWorkspace } from '@b2b-system/web-core/data-import';
import type { ImportMode } from '@b2b-system/web-core/data-transfer';
import { useTranslation } from '@b2b-system/web-core/locales';
import { RouteLink } from '@b2b-system/web-core/route-link';
import { useNavigate } from '@tanstack/react-router';
import { useMemo } from 'react';

import { PermissionKey, usePermission } from '@/core/permission';

import { orgUnitImportApi } from '../../hooks/orgUnitTransferApi';
import { OrgUnitImportRoute } from '../../routes';

/**
 * 部門匯入（docs/architecture/backend/22-data-transfer.md §12.3）：上層以代碼或路徑引用，也可以引用同一份檔案裡的其他列（§7.8），
 * 套用時被引用的部門先建立。
 */
export default function OrgUnitImportPage() {
  const { t } = useTranslation();
  const search = OrgUnitImportRoute.useSearch();
  const navigate = useNavigate();
  const { can } = usePermission();
  // 新增模式要 orgUnit:create；修改模式要 orgUnit:update（頁面權限已保證）
  const modes = useMemo<ImportMode[]>(
    () => (can(PermissionKey['orgUnit:create']) ? ['create', 'update'] : ['update']),
    [can],
  );
  const mode = modes.includes(search.mode) ? search.mode : (modes[0] ?? 'update');

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4" data-testid="org-unit-import-page">
      <PageHeader title={t('menu.orgUnitImport')} />
      <ImportWorkspace
        api={orgUnitImportApi}
        type="orgUnit"
        mode={mode}
        modes={modes}
        onModeChange={(next) =>
          void navigate({ to: OrgUnitImportRoute.to, search: { mode: next } })
        }
        transferId={search.transfer ?? null}
        onTransferChange={(transfer) =>
          void navigate({
            to: OrgUnitImportRoute.to,
            search: { mode, ...(transfer ? { transfer } : {}) },
            // 送出之後草稿已刪、預覽已清：不再提醒未儲存
            ignoreBlocker: true,
          })
        }
        renderRecordLink={(unitId) => (
          <RouteLink
            to="organization.unit"
            params={{ unitId }}
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
