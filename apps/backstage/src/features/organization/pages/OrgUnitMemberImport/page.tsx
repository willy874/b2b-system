import { PageHeader } from '@b2b-system/ui/PageHeader';
import { ImportWorkspace } from '@b2b-system/web-core/data-import';
import type { ImportMode } from '@b2b-system/web-core/data-transfer';
import { useTranslation } from '@b2b-system/web-core/locales';
import { RouteLink } from '@b2b-system/web-core/route-link';
import { useNavigate } from '@tanstack/react-router';

import { orgUnitImportApi } from '../../hooks/orgUnitTransferApi';
import { OrgUnitMemberImportRoute } from '../../routes';

/** 新增成員資格，或以匯出的 ID 修改主管、主要部門與職稱；移除成員在組織頁做（docs/architecture/backend/22-data-transfer.md §12.3）。 */
const MODES: ImportMode[] = ['create', 'update'];

export default function OrgUnitMemberImportPage() {
  const { t } = useTranslation();
  const search = OrgUnitMemberImportRoute.useSearch();
  const navigate = useNavigate();

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4" data-testid="org-unit-member-import-page">
      <PageHeader title={t('menu.orgUnitMemberImport')} />
      <ImportWorkspace
        api={orgUnitImportApi}
        type="orgUnitMember"
        mode={search.mode}
        modes={MODES}
        onModeChange={(next) =>
          void navigate({ to: OrgUnitMemberImportRoute.to, search: { mode: next } })
        }
        transferId={search.transfer ?? null}
        onTransferChange={(transfer) =>
          void navigate({
            to: OrgUnitMemberImportRoute.to,
            search: { mode: search.mode, ...(transfer ? { transfer } : {}) },
            ignoreBlocker: true,
          })
        }
        // 結果的紀錄是成員本人
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
