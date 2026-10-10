import { PageHeader } from '@b2b-system/ui/PageHeader';
import { ImportWorkspace } from '@b2b-system/web-core/data-import';
import type { ImportMode } from '@b2b-system/web-core/data-transfer';
import { useTranslation } from '@b2b-system/web-core/locales';
import { useNavigate } from '@tanstack/react-router';
import { useMemo } from 'react';

import { PermissionKey, usePermission } from '@/core/permission';

import { tagImportApi } from '../../hooks/tagTransferApi';
import { TagImportRoute } from '../../routes';

/** 標籤匯入（docs/architecture/backend/22-data-transfer.md §12.4）：名稱與顏色；標籤組是每一列的欄位。 */
export default function TagImportPage() {
  const { t } = useTranslation();
  const search = TagImportRoute.useSearch();
  const navigate = useNavigate();
  const { can } = usePermission();
  // 新增模式要 tag:create；修改模式要 tag:update（頁面權限已保證）
  const modes = useMemo<ImportMode[]>(
    () => (can(PermissionKey['tag:create']) ? ['create', 'update'] : ['update']),
    [can],
  );
  const mode = modes.includes(search.mode) ? search.mode : (modes[0] ?? 'update');

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4" data-testid="tag-import-page">
      <PageHeader title={t('menu.tagImport')} />
      <ImportWorkspace
        api={tagImportApi}
        type="tag"
        mode={mode}
        modes={modes}
        onModeChange={(next) => void navigate({ to: TagImportRoute.to, search: { mode: next } })}
        transferId={search.transfer ?? null}
        onTransferChange={(transfer) =>
          void navigate({
            to: TagImportRoute.to,
            search: { mode, ...(transfer ? { transfer } : {}) },
            // 送出之後草稿已刪、預覽已清：不再提醒未儲存
            ignoreBlocker: true,
          })
        }
      />
    </div>
  );
}
