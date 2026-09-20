import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import type { ColumnDef } from '@tanstack/react-table';
import { useMemo, useState } from 'react';

import { getAuditLogListQueryOptions } from '@/apis/audit-log/get-audit-log-list/query';
import { Button } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { DateRangePicker } from '@/components/DatePicker';
import { Input } from '@/components/Input';
import { Pagination } from '@/components/Pagination';
import { Select } from '@/components/Select';
import { Table } from '@/components/Table';
import { useTranslation } from '@/core/locales';
import type { AuditLog } from '@/shared/api-sdk';
import { formatDateTime } from '@/shared/date';

import { AuditLogListRoute } from '../../routes';
import type { AuditLogSearchQuery } from '../../routes';

const HIGH_RISK_ACTIONS = new Set(['auth.refresh.reuse_detected']);

export default function AuditLogListPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const search = AuditLogListRoute.useSearch();
  const [expanded, setExpanded] = useState<string>();
  const [actionDraft, setActionDraft] = useState(search.action ?? '');

  const patch = (next: Partial<AuditLogSearchQuery>) =>
    void navigate({ to: AuditLogListRoute.to, search: { ...search, ...next } });

  const { data, isPending } = useQuery(
    getAuditLogListQueryOptions({
      params: {
        offset: search.offset,
        limit: search.limit,
        action: search.action,
        resourceType: search.resourceType,
        result: search.result,
        from: search.from ? new Date(search.from).toISOString() : undefined,
        to: search.to ? new Date(`${search.to}T23:59:59`).toISOString() : undefined,
      },
    }),
  );

  const columns = useMemo<Array<ColumnDef<AuditLog, unknown>>>(
    () => [
      {
        id: 'occurredAt',
        header: t('auditLog.field.occurredAt'),
        enableSorting: false,
        cell: ({ row }) => formatDateTime(row.original.occurredAt),
      },
      {
        id: 'actorEmail',
        header: t('auditLog.field.actor'),
        enableSorting: false,
        cell: ({ row }) => row.original.actorEmail,
      },
      {
        id: 'action',
        header: t('auditLog.field.action'),
        enableSorting: false,
        cell: ({ row }) => (
          <span className="flex items-center gap-2">
            <code className="font-mono text-xs">{row.original.action}</code>
            {HIGH_RISK_ACTIONS.has(row.original.action) && (
              <Chip tone="danger">{t('auditLog.highRisk')}</Chip>
            )}
          </span>
        ),
      },
      {
        id: 'resource',
        header: t('auditLog.field.resource'),
        enableSorting: false,
        cell: ({ row }) =>
          `${row.original.resourceType}${row.original.resourceName ? ` · ${row.original.resourceName}` : ''}`,
      },
      {
        id: 'result',
        header: t('auditLog.field.result'),
        enableSorting: false,
        cell: ({ row }) =>
          row.original.result === 'success' ? (
            <Chip tone="success">{t('auditLog.result.success')}</Chip>
          ) : (
            <Chip tone="danger">{row.original.errorCode ?? t('auditLog.result.failure')}</Chip>
          ),
      },
      {
        id: 'expand',
        header: '',
        enableSorting: false,
        cell: ({ row }) => (
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              setExpanded((prev) => (prev === row.original.id ? undefined : row.original.id))
            }
            data-testid="audit-log-expand"
          >
            {expanded === row.original.id ? t('auditLog.collapse') : t('auditLog.expand')}
          </Button>
        ),
      },
    ],
    [expanded, t],
  );

  const detail = data?.items.find((item) => item.id === expanded);

  return (
    <div className="flex flex-col gap-4" data-testid="audit-log-page">
      <header>
        <h1 className="m-0 text-xl font-semibold">{t('auditLog.title')}</h1>
        <p className="mt-1 text-sm text-[var(--color-fg-muted)]">{t('auditLog.description')}</p>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          placeholder={t('auditLog.filter.actionPlaceholder')}
          value={actionDraft}
          onChange={(event) => setActionDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') patch({ action: actionDraft || undefined, offset: 0 });
          }}
          className="max-w-xs"
          data-testid="audit-log-action-input"
        />
        <Select
          value={search.resourceType ?? 'all'}
          onValueChange={(value) =>
            patch({ resourceType: value === 'all' ? undefined : value, offset: 0 })
          }
          options={[
            { value: 'all', label: t('auditLog.filter.allResources') },
            { value: 'user', label: t('permission.resource.user') },
            { value: 'role', label: t('permission.resource.role') },
            { value: 'auth', label: t('auditLog.resource.auth') },
            { value: 'authz', label: t('auditLog.resource.authz') },
          ]}
          className="w-44"
          aria-label={t('auditLog.field.resource')}
        />
        <Select
          value={search.result ?? 'all'}
          onValueChange={(value) =>
            patch({
              result: value === 'all' ? undefined : (value as AuditLogSearchQuery['result']),
              offset: 0,
            })
          }
          options={[
            { value: 'all', label: t('auditLog.filter.allResults') },
            { value: 'success', label: t('auditLog.result.success') },
            { value: 'failure', label: t('auditLog.result.failure') },
          ]}
          className="w-36"
          aria-label={t('auditLog.field.result')}
        />
        <DateRangePicker
          value={{ from: search.from ?? null, to: search.to ?? null }}
          onValueChange={({ from, to }) =>
            patch({ from: from ?? undefined, to: to ?? undefined, offset: 0 })
          }
          className="max-w-64"
          aria-label={t('auditLog.filter.range')}
          labels={{
            clear: t('common.reset'),
            open: t('auditLog.filter.range'),
            separator: '~',
          }}
          data-testid="audit-log-range"
        />
        <Button onClick={() => patch({ action: actionDraft || undefined, offset: 0 })}>
          {t('common.search')}
        </Button>
      </div>

      <Table
        data={data?.items ?? []}
        columns={columns}
        loading={isPending}
        getRowId={(row) => row.id}
        emptyTitle={t('common.empty')}
        data-testid="audit-log-table"
      />

      {detail && (
        <section
          className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4"
          data-testid="audit-log-detail"
        >
          <h2 className="m-0 mb-2 text-sm font-semibold">{t('auditLog.detail.title')}</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <p className="m-0 mb-1 text-xs text-[var(--color-fg-muted)]">
                {t('auditLog.detail.changes')}
              </p>
              <pre className="m-0 overflow-x-auto rounded bg-[var(--color-bg)] p-2 font-mono text-xs">
                {JSON.stringify(detail.changes ?? {}, null, 2)}
              </pre>
            </div>
            <div>
              <p className="m-0 mb-1 text-xs text-[var(--color-fg-muted)]">
                {t('auditLog.detail.metadata')}
              </p>
              <pre className="m-0 overflow-x-auto rounded bg-[var(--color-bg)] p-2 font-mono text-xs">
                {JSON.stringify(detail.metadata ?? {}, null, 2)}
              </pre>
            </div>
          </div>
        </section>
      )}

      <Pagination
        offset={search.offset}
        limit={search.limit}
        total={data?.pagination.total ?? 0}
        pageSizeOptions={[25, 50, 100]}
        onChange={({ offset, limit }) => patch({ offset, limit })}
        labels={{
          previous: t('common.previous'),
          next: t('common.next'),
          summary: ({ from, to, total }) => `${from}-${to} / ${total}`,
        }}
      />
    </div>
  );
}
