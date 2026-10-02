import { useQuery } from '@tanstack/react-query';
import { Outlet, useNavigate } from '@tanstack/react-router';
import { useMemo, useState } from 'react';

import { getWebhookListQueryOptions } from '@/apis/webhook/get-webhook-list/query';
import { AlertDialog } from '@/components/AlertDialog';
import { ButtonLink } from '@/components/Button';
import { useTranslation } from '@/core/locales';

import { useWebhookDeleteMutation } from '../../hooks/useWebhookMutations';
import { useWebhookPermission } from '../../hooks/useWebhookPermission';
import { WebhookCreateRoute, WebhookDetailRoute } from '../../routes';
import { toWebhookRowVM } from './adapter';
import type { WebhookRowVM } from './adapter';
import { WebhookTable } from './components/WebhookTable';
import { useWebhookSearchFilter } from './useWebhookSearchFilter';

/** Webhook（docs/adr/0030-webhooks.md）：事件發生時 POST 到外部系統。 */
export default function WebhookListPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const permission = useWebhookPermission();
  const { search, setKeyword, setPage } = useWebhookSearchFilter();
  const [pendingDelete, setPendingDelete] = useState<WebhookRowVM>();
  const deleteWebhook = useWebhookDeleteMutation();

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
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="m-0 text-xl font-semibold">{t('webhook.list.title')}</h1>
          <p className="mt-1 text-sm text-[var(--color-fg-muted)]">
            {t('webhook.list.description')}
          </p>
        </div>
        {permission.canCreate && (
          <ButtonLink
            variant="primary"
            to={WebhookCreateRoute.to}
            search={search}
            data-testid="webhook-create-button"
          >
            {t('webhook.create.action')}
          </ButtonLink>
        )}
      </header>

      <WebhookTable
        rows={rows}
        loading={isPending}
        search={search}
        canDelete={permission.canDelete}
        onRowDoubleClick={(row) =>
          void navigate({ to: WebhookDetailRoute.to, params: { webhookId: row.id }, search })
        }
        onDelete={setPendingDelete}
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

      <AlertDialog
        open={Boolean(pendingDelete)}
        onOpenChange={(open) => !open && setPendingDelete(undefined)}
        title={t('webhook.delete.title')}
        description={t('webhook.delete.confirm', { name: pendingDelete?.name ?? '' })}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        tone="danger"
        loading={deleteWebhook.isPending}
        onConfirm={async () => {
          if (!pendingDelete) return;
          try {
            await deleteWebhook.mutateAsync({ params: { webhookId: pendingDelete.id } });
          } catch {
            // 錯誤由 mutation 的 onError 顯示；對話框留著讓使用者重試或取消
            return;
          }
          setPendingDelete(undefined);
        }}
        data-testid="webhook-delete-confirm"
      />

      {/* 對話框子路由（建立／詳情）掛在列表頁內，列表在背後保持掛載 */}
      <Outlet />
    </div>
  );
}
