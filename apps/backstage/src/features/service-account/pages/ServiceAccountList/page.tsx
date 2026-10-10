import { Button, ButtonLink } from '@b2b-system/ui/Button';
import { useConfirm } from '@b2b-system/ui/ConfirmDialog';
import { Icon } from '@b2b-system/ui/Icon';
import { ExportDialog } from '@b2b-system/web-core/data-transfer';
import { useTranslation } from '@b2b-system/web-core/locales';
import { useListSearch } from '@b2b-system/web-core/router';
import { useQuery } from '@tanstack/react-query';
import { Outlet, useNavigate } from '@tanstack/react-router';
import { useCallback, useMemo, useState } from 'react';

import { getServiceAccountListQueryOptions } from '@/apis/service-account/get-service-account-list/query';

import { serviceAccountExportApi } from '../../hooks/serviceAccountExportApi';
import { useServiceAccountDeleteMutation } from '../../hooks/useServiceAccountMutations';
import { useServiceAccountPermission } from '../../hooks/useServiceAccountPermission';
import {
  ServiceAccountCreateRoute,
  ServiceAccountDetailRoute,
  ServiceAccountListRoute,
} from '../../routes';
import type { ServiceAccountSearchQuery } from '../../routes';
import { toServiceAccountRowVM } from './adapter';
import type { ServiceAccountRowVM } from './adapter';
import { ServiceAccountTable } from './components/ServiceAccountTable';

/** 服務帳號（docs/architecture/06-external-api.md §9.2 D1）：給 CI、建置流程等外部系統用的非人類帳號。 */
export default function ServiceAccountListPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const permission = useServiceAccountPermission();
  const { search, setKeyword, setSort, setPage } =
    useListSearch<ServiceAccountSearchQuery>(ServiceAccountListRoute);
  const { mutateAsync: deleteAccount } = useServiceAccountDeleteMutation();
  const confirm = useConfirm();
  // 它的 token 會一起失效，而且不能還原：先說清楚有幾把還在用。
  // 失敗時對話框留著讓使用者重試或取消，錯誤由 mutation 的 onError 顯示（docs/architecture/frontend/07-ui-system.md §3.11）
  const confirmDelete = useCallback(
    (row: ServiceAccountRowVM) =>
      void confirm({
        title: t('serviceAccount.delete.title'),
        description: t('serviceAccount.delete.confirm', {
          name: row.name,
          count: row.activeTokenCount,
        }),
        confirmLabel: t('common.delete'),
        tone: 'danger',
        onConfirm: () => deleteAccount({ params: { serviceAccountId: row.id } }),
        'data-testid': 'service-account-delete-confirm',
      }),
    [confirm, deleteAccount, t],
  );
  const [exporting, setExporting] = useState(false);

  const { data, isPending, error, refetch } = useQuery(
    getServiceAccountListQueryOptions({
      params: {
        offset: search.offset,
        limit: search.limit,
        keyword: search.keyword,
        sort: search.sort,
      },
    }),
  );
  const rows = useMemo(() => (data?.items ?? []).map(toServiceAccountRowVM), [data]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4" data-testid="service-account-list-page">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="m-0 text-xl font-semibold">{t('serviceAccount.list.title')}</h1>
          <p className="mt-1 text-sm text-[var(--color-fg-muted)]">
            {t('serviceAccount.list.description')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {permission.canExport && (
            <Button
              variant="secondary"
              startIcon={<Icon name="download" size={16} />}
              onClick={() => setExporting(true)}
              data-testid="service-account-export-button"
            >
              {t('dataTransfer.export.action')}
            </Button>
          )}
          {permission.canCreate && (
            <ButtonLink
              variant="primary"
              to={ServiceAccountCreateRoute.to}
              search={search}
              data-testid="service-account-create-button"
            >
              {t('serviceAccount.create.action')}
            </ButtonLink>
          )}
        </div>
      </header>

      <ServiceAccountTable
        rows={rows}
        loading={isPending}
        search={search}
        canDelete={permission.canDelete}
        onSortingChange={setSort}
        onRowDoubleClick={(row) =>
          void navigate({
            to: ServiceAccountDetailRoute.to,
            params: { serviceAccountId: row.id },
            search,
          })
        }
        onDelete={confirmDelete}
        searchBox={{
          value: search.keyword,
          onChange: setKeyword,
          placeholder: t('serviceAccount.list.searchPlaceholder'),
        }}
        error={error}
        onRetry={() => void refetch()}
        pagination={{
          offset: search.offset,
          limit: search.limit,
          total: data?.pagination.total ?? 0,
          onChange: ({ offset, limit }) => setPage(offset, limit),
        }}
      />

      <ExportDialog
        open={exporting}
        onOpenChange={setExporting}
        api={serviceAccountExportApi}
        type="serviceAccount"
        filter={{ keyword: search.keyword }}
        matchingTotal={data?.pagination.total ?? 0}
        data-testid="service-account-export-dialog"
      />

      {/* 對話框子路由（建立／詳情）掛在列表頁內，列表在背後保持掛載 */}
      <Outlet />
    </div>
  );
}
