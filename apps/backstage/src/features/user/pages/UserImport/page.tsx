import { ImportWorkspace } from '@b2b-system/web-core/data-import';
import type { ImportMode } from '@b2b-system/web-core/data-transfer';
import { useTranslation } from '@b2b-system/web-core/locales';
import { RouteLink } from '@b2b-system/web-core/route-link';
import { useNavigate } from '@tanstack/react-router';
import { useMemo } from 'react';

import { usePermission, PermissionKey } from '@/core/permission';

import { userImportApi } from '../../hooks/userTransferApi';
import { UserImportRoute } from '../../routes';

/** 使用者匯入（docs/architecture/backend/22-data-transfer.md §7.2）：把 fetcher 與 `type: 'user'` 交給 web-core 的匯入工作區。 */
export default function UserImportPage() {
  const { t } = useTranslation();
  const search = UserImportRoute.useSearch();
  const navigate = useNavigate();
  const { can } = usePermission();
  // 新增模式要 user:create；修改模式要 user:update（頁面權限已保證）
  const modes = useMemo<ImportMode[]>(
    () => (can(PermissionKey['user:create']) ? ['create', 'update'] : ['update']),
    [can],
  );
  const mode = modes.includes(search.mode) ? search.mode : (modes[0] ?? 'update');

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4" data-testid="user-import-page">
      <header>
        <h1 className="m-0 text-xl font-semibold">{t('menu.userImport')}</h1>
      </header>
      <ImportWorkspace
        api={userImportApi}
        type="user"
        mode={mode}
        modes={modes}
        onModeChange={(next) => void navigate({ to: UserImportRoute.to, search: { mode: next } })}
        transferId={search.transfer ?? null}
        onTransferChange={(transfer) =>
          void navigate({
            to: UserImportRoute.to,
            search: { mode, ...(transfer ? { transfer } : {}) },
            // 送出之後草稿已刪、預覽已清：不再提醒未儲存
            ignoreBlocker: true,
          })
        }
        renderRecordLink={(userId) => (
          <RouteLink
            to="user.detail"
            params={{ userId }}
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
