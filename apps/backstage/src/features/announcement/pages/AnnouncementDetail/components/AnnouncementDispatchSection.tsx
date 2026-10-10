import { Button } from '@b2b-system/ui/Button';
import { Chip } from '@b2b-system/ui/Chip';
import { useConfirm } from '@b2b-system/ui/ConfirmDialog';
import type { TableColumnDef } from '@b2b-system/ui/Table';
import { RichTable } from '@b2b-system/web-core/components';
import { useTranslation } from '@b2b-system/web-core/locales';
import { RouteLink } from '@b2b-system/web-core/route-link';
import { formatDateTime } from '@b2b-system/web-shared/date';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

import { getAnnouncementDispatchesQueryOptions } from '@/apis/announcement/get-announcement-dispatches/query';
import type { AnnouncementDispatch } from '@/shared/api-sdk';

import {
  ANNOUNCEMENT_DISPATCH_PAGE_SIZE,
  DISPATCH_STATUS_LABEL_KEY,
  DISPATCH_STATUS_TONE,
} from '../../../constants';
import { useAnnouncementDispatchRevokeMutation } from '../../../hooks/useAnnouncementMutations';

interface AnnouncementDispatchSectionProps {
  announcementId: string;
  canRevoke: boolean;
}

/** 收件人超過上限而失敗（docs/architecture/backend/19-announcement.md §9.2 D6）的說明；其他原因不顯示。 */
function failureOf(dispatch: AnnouncementDispatch): { count: number; max: number } | undefined {
  const details = dispatch.details;
  if (details?.reason !== 'tooManyRecipients') return undefined;
  const { count, max } = details;
  return typeof count === 'number' && typeof max === 'number' ? { count, max } : undefined;
}

/**
 * 發送紀錄：每一次實際送出一列（時間、狀態、人數、已讀數）。撤回刪除收件人的通知、紀錄保留（D18）。
 * 發送在背景進行：狀態由推播（`announcement` update）更新。
 */
export function AnnouncementDispatchSection({
  announcementId,
  canRevoke,
}: AnnouncementDispatchSectionProps) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const revoke = useAnnouncementDispatchRevokeMutation();
  const [offset, setOffset] = useState(0);
  const { data, isPending, error, refetch } = useQuery(
    getAnnouncementDispatchesQueryOptions({
      params: { announcementId, offset, limit: ANNOUNCEMENT_DISPATCH_PAGE_SIZE },
    }),
  );

  const columns = useMemo<Array<TableColumnDef<AnnouncementDispatch>>>(
    () => [
      {
        id: 'scheduledFor',
        header: t('announcement.dispatch.field.scheduledFor'),
        enableSorting: false,
        cell: ({ row }) => formatDateTime(row.original.scheduledFor),
      },
      {
        id: 'status',
        header: t('announcement.dispatch.field.status'),
        enableSorting: false,
        cell: ({ row }) => {
          const failure = failureOf(row.original);
          return (
            <span className="flex flex-col gap-1">
              <Chip
                tone={DISPATCH_STATUS_TONE[row.original.status]}
                data-testid="announcement-dispatch-status"
                data-value={row.original.status}
              >
                {t(DISPATCH_STATUS_LABEL_KEY[row.original.status])}
              </Chip>
              {failure && (
                <span className="text-xs text-[var(--color-danger-text)]">
                  {t('announcement.dispatch.tooManyRecipients', failure)}
                </span>
              )}
            </span>
          );
        },
      },
      {
        id: 'recipients',
        header: t('announcement.dispatch.field.recipients'),
        enableSorting: false,
        cell: ({ row }) =>
          row.original.recipientCount === null ? (
            '-'
          ) : (
            // 收件人與已讀狀態在通知總覽（沒有 notification:read 時只顯示文字）
            <RouteLink
              to="notification.overviewBySource"
              params={{ sourceId: row.original.id }}
              className="text-[var(--color-brand)]"
              data-testid="announcement-dispatch-recipients"
            >
              {t('announcement.readSummary', {
                read: row.original.readCount,
                total: row.original.recipientCount,
              })}
            </RouteLink>
          ),
      },
      {
        id: 'createdBy',
        header: t('announcement.dispatch.field.createdBy'),
        enableSorting: false,
        cell: ({ row }) => row.original.createdBy?.displayName ?? '-',
      },
      {
        id: 'actions',
        header: t('common.actions'),
        enableSorting: false,
        cell: ({ row }) =>
          canRevoke &&
          row.original.status !== 'revoked' && (
            <Button
              size="sm"
              variant="danger"
              onClick={() =>
                void confirm({
                  title: t('announcement.revoke.title'),
                  description: t('announcement.revoke.confirm'),
                  confirmLabel: t('announcement.revoke.action'),
                  tone: 'danger',
                  onConfirm: async () => {
                    await revoke.mutateAsync({
                      params: { announcementId, dispatchId: row.original.id },
                    });
                  },
                  'data-testid': 'announcement-revoke-confirm',
                })
              }
              data-testid="announcement-revoke"
              data-value={row.original.id}
            >
              {t('announcement.revoke.action')}
            </Button>
          ),
      },
    ],
    [announcementId, canRevoke, confirm, revoke, t],
  );

  return (
    <section className="flex flex-col gap-2" data-testid="announcement-dispatch-section">
      <h3 className="m-0 text-sm font-semibold">{t('announcement.dispatch.title')}</h3>
      <RichTable
        data={data?.items ?? []}
        columns={columns}
        loading={isPending}
        getRowId={getRowId}
        enableRowSelection={false}
        error={error}
        onRetry={() => void refetch()}
        emptyTitle={t('announcement.dispatch.empty')}
        pagination={{
          offset,
          limit: ANNOUNCEMENT_DISPATCH_PAGE_SIZE,
          total: data?.pagination.total ?? 0,
          onChange: (next) => setOffset(next.offset),
        }}
        data-testid="announcement-dispatch-table"
      />
    </section>
  );
}

const getRowId = (row: AnnouncementDispatch) => row.id;
