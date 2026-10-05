import { Button } from '@b2b-system/ui/Button';
import { Chip } from '@b2b-system/ui/Chip';
import { Dialog } from '@b2b-system/ui/Dialog';
import { TextEllipsis } from '@b2b-system/ui/Ellipsis';
import { Select } from '@b2b-system/ui/Select';
import type { TableColumnDef } from '@b2b-system/ui/Table';
import { RichTable } from '@b2b-system/web-core/components';
import { useTranslation } from '@b2b-system/web-core/locales';
import { formatDateTime } from '@b2b-system/web-shared/date';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

import { getWebhookDeliveriesQueryOptions } from '@/apis/webhook/get-webhook-deliveries/query';
import type { WebhookTarget } from '@/shared/api-sdk';

import {
  WEBHOOK_DELIVERY_PAGE_SIZE,
  WEBHOOK_DELIVERY_TRIGGER_KEY,
  WEBHOOK_EVENT_LABEL,
} from '../../../constants';
import { useWebhookRedeliverMutation } from '../../../hooks/useWebhookMutations';
import { toWebhookDeliveryRowVM } from '../adapter';
import type { WebhookDeliveryRowVM } from '../adapter';

type ResultFilter = 'all' | 'succeeded' | 'failed';

const SUCCEEDED_OF = {
  all: undefined,
  succeeded: true,
  failed: false,
} as const satisfies Record<ResultFilter, boolean | undefined>;

const RESULT_FILTER_LABEL_KEY = {
  all: 'webhook.delivery.filter.all',
  succeeded: 'webhook.delivery.filter.succeeded',
  failed: 'webhook.delivery.filter.failed',
} as const satisfies Record<ResultFilter, string>;

/** 網址篩選的「全部」：不帶 `targetId`。 */
const ALL_TARGETS = 'all';

interface WebhookDeliverySectionProps {
  webhookId: string;
  /** 目前的網址：多於一個時可以依網址篩選（docs/architecture/backend/17-webhook.md §10.2 D16）。 */
  targets: WebhookTarget[];
  /** 停用中的 webhook 不能重送（D17）。 */
  canRedeliver: boolean;
}

/**
 * 投遞紀錄（docs/architecture/backend/17-webhook.md §9.2 D12、D16、D17）：每一次嘗試一筆，保留 30 天。
 * 新的投遞由推播（`webhookDelivery`）讓這裡重抓。
 */
export function WebhookDeliverySection({
  webhookId,
  targets,
  canRedeliver,
}: WebhookDeliverySectionProps) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<ResultFilter>('all');
  const [targetId, setTargetId] = useState<string>(ALL_TARGETS);
  const [offset, setOffset] = useState(0);
  const [viewing, setViewing] = useState<WebhookDeliveryRowVM>();
  const redeliver = useWebhookRedeliverMutation();

  const deliveries = useQuery(
    getWebhookDeliveriesQueryOptions({
      params: {
        webhookId,
        offset,
        limit: WEBHOOK_DELIVERY_PAGE_SIZE,
        succeeded: SUCCEEDED_OF[filter],
        targetId: targetId === ALL_TARGETS ? undefined : targetId,
      },
    }),
  );
  const rows = useMemo(
    () => (deliveries.data?.items ?? []).map(toWebhookDeliveryRowVM),
    [deliveries.data],
  );

  const columns = useMemo<Array<TableColumnDef<WebhookDeliveryRowVM>>>(
    () => [
      {
        id: 'createdAt',
        header: t('webhook.delivery.field.createdAt'),
        enableSorting: false,
        cell: ({ row }) => formatDateTime(row.original.createdAt),
      },
      {
        id: 'eventType',
        header: t('webhook.delivery.field.event'),
        enableSorting: false,
        cell: ({ row }) => {
          const label = WEBHOOK_EVENT_LABEL[row.original.eventType];
          return label ? t(label.nameKey) : row.original.eventType;
        },
      },
      {
        id: 'url',
        header: t('webhook.delivery.field.url'),
        enableSorting: false,
        cell: ({ row }) => <TextEllipsis className="max-w-48">{row.original.url}</TextEllipsis>,
      },
      {
        id: 'attempt',
        header: t('webhook.delivery.field.attempt'),
        enableSorting: false,
        cell: ({ row }) =>
          t('webhook.delivery.attempt', {
            attempt: row.original.attempt,
            trigger: t(WEBHOOK_DELIVERY_TRIGGER_KEY[row.original.trigger]),
          }),
      },
      {
        id: 'result',
        header: t('webhook.delivery.field.result'),
        enableSorting: false,
        cell: ({ row }) => (
          <Chip
            tone={row.original.succeeded ? 'success' : 'danger'}
            data-testid="webhook-delivery-result"
            data-value={row.original.succeeded ? 'succeeded' : 'failed'}
          >
            {row.original.result}
          </Chip>
        ),
      },
      {
        id: 'durationMs',
        header: t('webhook.delivery.field.duration'),
        enableSorting: false,
        cell: ({ row }) => t('webhook.delivery.duration', { ms: row.original.durationMs }),
      },
      {
        id: 'actions',
        header: t('common.actions'),
        enableSorting: false,
        cell: ({ row }) => (
          <div className="flex gap-1">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setViewing(row.original)}
              data-testid="webhook-delivery-view"
            >
              {t('webhook.delivery.view')}
            </Button>
            {canRedeliver && (
              <Button
                size="sm"
                variant="ghost"
                loading={
                  redeliver.isPending && redeliver.variables.params.deliveryId === row.original.id
                }
                onClick={() =>
                  void redeliver.mutateAsync({
                    params: { webhookId, deliveryId: row.original.id },
                  })
                }
                data-testid="webhook-delivery-redeliver"
              >
                {t('webhook.delivery.redeliver')}
              </Button>
            )}
          </div>
        ),
      },
    ],
    [canRedeliver, redeliver, t, webhookId],
  );

  return (
    <section className="flex flex-col gap-2" data-testid="webhook-delivery-section">
      <div className="flex items-center justify-between gap-2">
        <h3 className="m-0 shrink-0 text-sm font-semibold">{t('webhook.detail.deliveries')}</h3>
        <span className="flex-1" />
        {targets.length > 1 && (
          <Select
            size="sm"
            className="w-48 min-w-0"
            options={[
              { value: ALL_TARGETS, label: t('webhook.delivery.filter.allUrls') },
              ...targets.map((target) => ({ value: target.id, label: target.url })),
            ]}
            value={targetId}
            onValueChange={(value) => {
              setTargetId(value);
              setOffset(0);
            }}
            aria-label={t('webhook.delivery.field.url')}
            data-testid="webhook-delivery-target-filter"
          />
        )}
        <Select
          size="sm"
          className="w-32 shrink-0"
          options={(['all', 'succeeded', 'failed'] as const).map((value) => ({
            value,
            label: t(RESULT_FILTER_LABEL_KEY[value]),
          }))}
          value={filter}
          onValueChange={(value) => {
            setFilter(value);
            setOffset(0);
          }}
          aria-label={t('webhook.delivery.field.result')}
          data-testid="webhook-delivery-filter"
        />
      </div>
      <p className="m-0 text-xs text-[var(--color-fg-muted)]">
        {t('webhook.detail.deliveriesHint')}
      </p>
      <RichTable
        data={rows}
        columns={columns}
        loading={deliveries.isPending}
        getRowId={getRowId}
        enableRowSelection={false}
        error={deliveries.error}
        onRetry={() => void deliveries.refetch()}
        pagination={{
          offset,
          limit: WEBHOOK_DELIVERY_PAGE_SIZE,
          total: deliveries.data?.pagination.total ?? 0,
          onChange: (next) => setOffset(next.offset),
        }}
        data-testid="webhook-delivery-table"
      />

      <Dialog
        open={Boolean(viewing)}
        onOpenChange={(open) => !open && setViewing(undefined)}
        title={t('webhook.delivery.detailTitle')}
        size="md"
        footer={<Button onClick={() => setViewing(undefined)}>{t('common.close')}</Button>}
        data-testid="webhook-delivery-detail"
      >
        {viewing && (
          <div className="flex flex-col gap-3 text-sm">
            <div>
              <h4 className="m-0 mb-1 text-xs font-semibold">{t('webhook.delivery.field.url')}</h4>
              <code className="break-all">{viewing.url}</code>
            </div>
            <div>
              <h4 className="m-0 mb-1 text-xs font-semibold">{t('webhook.delivery.eventId')}</h4>
              <code className="break-all">{viewing.eventId}</code>
            </div>
            <div>
              <h4 className="m-0 mb-1 text-xs font-semibold">{t('webhook.delivery.payload')}</h4>
              {/* 只有 id 與列舉值（D3），內容很短：直接排版顯示 */}
              <pre className="m-0 max-h-48 overflow-auto rounded bg-[var(--color-fill-subtle)] p-2 text-xs">
                {JSON.stringify({ type: viewing.eventType, data: viewing.eventData }, null, 2)}
              </pre>
            </div>
            <div>
              <h4 className="m-0 mb-1 text-xs font-semibold">{t('webhook.delivery.response')}</h4>
              <pre className="m-0 max-h-48 overflow-auto rounded bg-[var(--color-fill-subtle)] p-2 text-xs break-all whitespace-pre-wrap">
                {viewing.responseBody || t('webhook.delivery.noResponse')}
              </pre>
            </div>
          </div>
        )}
      </Dialog>
    </section>
  );
}

const getRowId = (row: WebhookDeliveryRowVM) => row.id;
