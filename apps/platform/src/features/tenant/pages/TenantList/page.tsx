import { Button } from '@b2b-system/ui/Button';
import { useTranslation } from '@b2b-system/web-core/locales';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useMemo, useState } from 'react';

import { getStorageTotalQueryOptions } from '@/apis/platform-tenant/get-storage-total/query';
import { getTenantListQueryOptions } from '@/apis/platform-tenant/get-tenant-list/query';

import { TENANT_PAGE_SIZE_OPTIONS } from '../../constants';
import { useTenantPermission } from '../../hooks/useTenantPermission';
import { DEFAULT_TENANT_DETAIL_SEARCH, TenantDetailRoute } from '../../routes';
import { toStorageTotalVM, toTenantRowVM } from './adapter';
import { CreateTenantDialog } from './components/CreateTenantDialog';
import { StorageTotalBar } from './components/StorageTotalBar';
import { TenantTable } from './components/TenantTable';
import { useTenantFilters } from './useTenantFilters';
import { useTenantSearchFilter } from './useTenantSearchFilter';

/**
 * 平台管理者的租戶清單（docs/architecture/05-tenancy.md §10.2 D12、D13）：
 * 代碼、名稱、狀態、主要網域與用量摘要（§5.4）；點進去看詳情與停用、刪除。
 * 上方是所有租戶的已用量與儲存的止水線（docs/architecture/backend/25-image.md §12）。
 * 伺服器分頁、代碼／名稱／網域搜尋、狀態篩選與排序，條件放在網址上（routes/model.ts）。
 */
export default function TenantListPage() {
  const { t } = useTranslation();
  const permission = useTenantPermission();
  const navigate = useNavigate();
  const searchFilter = useTenantSearchFilter();
  const { search, setPage, setSort } = searchFilter;
  const filters = useTenantFilters(searchFilter);
  const [creating, setCreating] = useState(false);

  const { data, isPending, error, refetch } = useQuery(
    getTenantListQueryOptions({
      offset: search.offset,
      limit: search.limit,
      q: search.q,
      status: search.status,
      sort: search.sort,
    }),
  );
  // 儲存的止水線（docs/architecture/backend/25-image.md §12）：部署沒有啟用時不顯示；讀不到只是少一條資訊，不擋清單
  const { data: storageTotal } = useQuery(getStorageTotalQueryOptions());
  const storageTotalVM = storageTotal ? toStorageTotalVM(storageTotal) : null;
  const rows = useMemo(
    () => (data?.items ?? []).map((item) => toTenantRowVM(item, data?.usageWarningRatio ?? 1)),
    [data],
  );

  const openDetail = (id: string, options?: { ignoreBlocker?: boolean }) =>
    void navigate({
      to: TenantDetailRoute.to,
      params: { id },
      search: DEFAULT_TENANT_DETAIL_SEARCH,
      ...options,
    });

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4" data-testid="tenant-page">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="m-0 text-xl font-semibold">{t('tenant.title')}</h1>
          <p className="mt-1 text-sm text-[var(--color-fg-muted)]">{t('tenant.description')}</p>
        </div>
        {permission.canCreate && (
          <Button
            variant="primary"
            onClick={() => setCreating(true)}
            data-testid="tenant-create-button"
          >
            {t('tenant.create.action')}
          </Button>
        )}
      </header>

      {storageTotalVM && <StorageTotalBar total={storageTotalVM} />}

      <TenantTable
        rows={rows}
        loading={isPending}
        filtered={Boolean(search.q || search.status)}
        filters={filters}
        searchBox={{
          value: search.q,
          onChange: (q) => filters.onSubmit({ ...filters.value, q }),
          placeholder: t('tenant.filter.qPlaceholder'),
        }}
        error={error}
        onRetry={() => void refetch()}
        pagination={{
          offset: search.offset,
          limit: search.limit,
          total: data?.pagination.total ?? 0,
          pageSizeOptions: TENANT_PAGE_SIZE_OPTIONS,
          onChange: ({ offset, limit }) => setPage(offset, limit),
        }}
        sort={search.sort}
        onSortingChange={setSort}
        onRowDoubleClick={(row) => openDetail(row.id)}
      />

      <CreateTenantDialog
        open={creating}
        baseDomain={data?.baseDomain ?? ''}
        onClose={() => setCreating(false)}
        onCreated={(id) => {
          setCreating(false);
          // 建立成功：對話框的未儲存提醒還來不及隨 `creating` 解除，導覽要略過它
          openDetail(id, { ignoreBlocker: true });
        }}
      />
    </div>
  );
}
