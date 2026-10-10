import { Button } from '@b2b-system/ui/Button';
import { QuerySection } from '@b2b-system/web-core/components';
import { downloadFromUrl, TransferTable } from '@b2b-system/web-core/data-transfer';
import type { TransferView } from '@b2b-system/web-core/data-transfer';
import { useTranslation } from '@b2b-system/web-core/locales';
import { RouteLink } from '@b2b-system/web-core/route-link';
import { useRouteSearch } from '@b2b-system/web-core/router';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';

import { fetchDeleteTransferMutation } from '@/apis/data-transfer/delete-transfer/fetcher';
import { getTransferListQueryOptions } from '@/apis/data-transfer/get-transfer-list/query';
import { getTransferResourcesQueryOptions } from '@/apis/data-transfer/get-transfer-resources/query';
import { getTransferQueryOptions } from '@/apis/data-transfer/get-transfer/query';
import { invalidateResources, Resource } from '@/apis/resources';

import { dataTransferApi } from '../../hooks/dataTransferApi';
import { DataTransferListRoute } from '../../routes';
import type { DataTransferSearchQuery } from '../../routes';

/**
 * 匯入完成的「查看結果」：到該資源的匯入頁。route id 依資源類型，每一種都寫成字面量
 * （docs/architecture/frontend/03-feature-anatomy.md §4.1）；那個 feature 沒有註冊（未啟用、沒有權限）時不顯示。
 */
function ResultLink({ transfer, label }: { transfer: TransferView; label: string }) {
  const props = {
    params: { mode: transfer.mode ?? 'create', transferId: transfer.id },
    fallback: 'hide' as const,
    className: 'text-sm text-[var(--color-brand)]',
    'data-testid': 'data-transfer-result',
    'data-value': transfer.id,
    children: label,
  };
  switch (transfer.type) {
    case 'user':
      return <RouteLink to="user.import" {...props} />;
    case 'role':
      return <RouteLink to="role.import" {...props} />;
    case 'group':
      return <RouteLink to="group.import" {...props} />;
    case 'groupMember':
      return <RouteLink to="groupMember.import" {...props} />;
    case 'orgUnit':
      return <RouteLink to="orgUnit.import" {...props} />;
    case 'orgUnitMember':
      return <RouteLink to="orgUnitMember.import" {...props} />;
    case 'tag':
      return <RouteLink to="tag.import" {...props} />;
    default:
      return null;
  }
}

/** 我的匯入匯出（docs/architecture/backend/22-data-transfer.md §8.4）。 */
export default function DataTransferListPage() {
  const { t } = useTranslation();
  const { search, patch } = useRouteSearch<DataTransferSearchQuery>(DataTransferListRoute);
  const { data, isPending, error, refetch } = useQuery(
    getTransferListQueryOptions({ params: { offset: search.offset, limit: search.limit } }),
  );
  const resources = useQuery(getTransferResourcesQueryOptions());
  // 從「匯出完成」等通知點進來（`?transfer=<id>`）：那一筆不一定在第一頁，單獨取出來放在列表上方
  const highlighted = useQuery({
    ...getTransferQueryOptions(search.transfer ?? ''),
    enabled: Boolean(search.transfer),
  });
  /** 關掉上方那一筆或翻頁時拿掉 `transfer`（不留瀏覽紀錄）。 */
  const dismissHighlight = (next: Partial<DataTransferSearchQuery> = {}) =>
    patch({ ...next, transfer: undefined }, { replace: true });
  const labels = useMemo(
    () => new Map((resources.data?.items ?? []).map((item) => [item.type, item.label])),
    [resources.data],
  );
  const resourceLabel = useCallback((type: string) => labels.get(type) ?? type, [labels]);

  const onDownload = useCallback(async (transfer: TransferView) => {
    const { url, fileName } = await dataTransferApi.download(transfer.id);
    downloadFromUrl(url, fileName);
  }, []);
  const onCancel = useCallback(async (transfer: TransferView) => {
    await dataTransferApi.cancel(transfer.id, transfer.version);
    invalidateResources([{ resource: Resource.DATA_TRANSFER, kind: 'update', id: transfer.id }]);
  }, []);
  const onDelete = useCallback(async (transfer: TransferView) => {
    await fetchDeleteTransferMutation({ params: { transferId: transfer.id } });
    invalidateResources([{ resource: Resource.DATA_TRANSFER, kind: 'delete', id: transfer.id }]);
  }, []);
  const renderResultLink = useCallback(
    (transfer: TransferView) => (
      <ResultLink transfer={transfer} label={t('dataTransfer.list.viewResult')} />
    ),
    [t],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4" data-testid="data-transfer-page">
      <header>
        <h1 className="m-0 text-xl font-semibold">{t('dataTransfer.list.title')}</h1>
        <p className="mt-1 text-sm text-[var(--color-fg-muted)]">
          {t('dataTransfer.list.description')}
        </p>
      </header>
      {search.transfer && (
        <section
          className="flex flex-col gap-2 rounded-[var(--radius-md)] border border-[var(--color-brand)] p-3"
          data-testid="data-transfer-highlight"
        >
          <div className="flex items-center justify-between gap-2">
            <h2 className="m-0 text-sm font-semibold">{t('dataTransfer.list.highlightTitle')}</h2>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => dismissHighlight()}
              data-testid="data-transfer-highlight-close"
            >
              {t('common.close')}
            </Button>
          </div>
          <QuerySection query={highlighted} data-testid="data-transfer-highlight-error">
            {(transfer) => (
              <TransferTable
                items={[transfer]}
                loading={false}
                error={undefined}
                onRetry={() => void highlighted.refetch()}
                resourceLabel={resourceLabel}
                onDownload={onDownload}
                onCancel={onCancel}
                onDelete={onDelete}
                renderResultLink={renderResultLink}
                data-testid="data-transfer-highlight-table"
              />
            )}
          </QuerySection>
        </section>
      )}
      <TransferTable
        items={data?.items ?? []}
        loading={isPending}
        error={error}
        onRetry={() => void refetch()}
        pagination={{
          offset: search.offset,
          limit: search.limit,
          total: data?.pagination.total ?? 0,
          onChange: (next) => (search.transfer ? dismissHighlight(next) : patch(next)),
        }}
        resourceLabel={resourceLabel}
        onDownload={onDownload}
        onCancel={onCancel}
        onDelete={onDelete}
        renderResultLink={renderResultLink}
      />
    </div>
  );
}
