import { ButtonLink } from '@b2b-system/ui/Button';
import { useConfirm } from '@b2b-system/ui/ConfirmDialog';
import { PageHeader } from '@b2b-system/ui/PageHeader';
import { useTranslation } from '@b2b-system/web-core/locales';
import { useListSearch } from '@b2b-system/web-core/router';
import { useQuery } from '@tanstack/react-query';
import { Outlet, useNavigate } from '@tanstack/react-router';
import { useCallback, useMemo } from 'react';

import { getWebhookListQueryOptions } from '@/apis/webhook/get-webhook-list/query';

import { useWebhookDeleteMutation } from '../../hooks/useWebhookMutations';
import { useWebhookPermission } from '../../hooks/useWebhookPermission';
import { WebhookCreateRoute, WebhookDetailRoute, WebhookListRoute } from '../../routes';
import type { WebhookSearchQuery } from '../../routes';
import { toWebhookRowVM } from './adapter';
import type { WebhookRowVM } from './adapter';
import { WebhookTable } from './components/WebhookTable';

/** Webhook（docs/architecture/backend/17-webhook.md §9）：事件發生時 POST 到外部系統。 */
export default function WebhookListPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const permission = useWebhookPermission();
  const { search, setKeyword, setPage } = useListSearch<WebhookSearchQuery>(WebhookListRoute);
  const confirm = useConfirm();
  const { mutateAsync: deleteWebhook } = useWebhookDeleteMutation();
  // 失敗時對話框留著讓使用者重試或取消，錯誤由 mutation 的 onError 顯示（docs/architecture/frontend/07-ui-system.md §3.11）
  const confirmDelete = useCallback(
    (row: WebhookRowVM) =>
      void confirm({
        title: t('webhook.delete.title'),
        description: t('webhook.delete.confirm', { name: row.name }),
        confirmLabel: t('common.delete'),
        tone: 'danger',
        onConfirm: () => deleteWebhook({ params: { webhookId: row.id } }),
        'data-testid': 'webhook-delete-confirm',
      }),
    [confirm, deleteWebhook, t],
  );

  const { data, isPending, error, refetch } = useQuery(
    getWebhookListQueryOptions({
      params: {
        offset: search.offset,
        limit: search.limit,
        keyword: search.keyword,
        status: search.status,
      },
    }),
  );
  const rows = useMemo(() => (data?.items ?? []).map(toWebhookRowVM), [data]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4" data-testid="webhook-list-page">
      <PageHeader
        title={t('webhook.list.title')}
        description={t('webhook.list.description')}
        actions={
          permission.canCreate && (
            <ButtonLink
              variant="primary"
              to={WebhookCreateRoute.to}
              search={search}
              data-testid="webhook-create-button"
            >
              {t('webhook.create.action')}
            </ButtonLink>
          )
        }
      />

      <WebhookTable
        rows={rows}
        loading={isPending}
        search={search}
        canDelete={permission.canDelete}
        onRowDoubleClick={(row) =>
          void navigate({ to: WebhookDetailRoute.to, params: { webhookId: row.id }, search })
        }
        onDelete={confirmDelete}
        searchBox={{
          value: search.keyword,
          onChange: setKeyword,
          placeholder: t('webhook.list.searchPlaceholder'),
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

      {/* 對話框子路由（建立／詳情）掛在列表頁內，列表在背後保持掛載 */}
      <Outlet />
    </div>
  );
}
