import { ImportWorkspace } from '@b2b-system/web-core/data-import';
import type { ImportMode } from '@b2b-system/web-core/data-transfer';
import { useTranslation } from '@b2b-system/web-core/locales';
import { RouteLink } from '@b2b-system/web-core/route-link';
import { useNavigate } from '@tanstack/react-router';

import { groupImportApi } from '../../hooks/groupTransferApi';
import { GroupMemberImportRoute } from '../../routes';

/** 群組成員只有新增模式（加成員）；移除成員在群組詳情做（docs/architecture/backend/22-data-transfer.md §12.2）。 */
const MODES: ImportMode[] = ['create'];

/** 群組成員匯入：一列一筆「群組 × 使用者（或成員群組）」。 */
export default function GroupMemberImportPage() {
  const { t } = useTranslation();
  const search = GroupMemberImportRoute.useSearch();
  const navigate = useNavigate();

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4" data-testid="group-member-import-page">
      <header>
        <h1 className="m-0 text-xl font-semibold">{t('menu.groupMemberImport')}</h1>
      </header>
      <ImportWorkspace
        api={groupImportApi}
        type="groupMember"
        mode="create"
        modes={MODES}
        onModeChange={() => undefined}
        transferId={search.transfer ?? null}
        onTransferChange={(transfer) =>
          void navigate({
            to: GroupMemberImportRoute.to,
            search: { mode: 'create', ...(transfer ? { transfer } : {}) },
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
