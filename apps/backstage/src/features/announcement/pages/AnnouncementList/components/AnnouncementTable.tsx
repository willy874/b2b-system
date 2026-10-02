import { Link } from '@tanstack/react-router';
import { useMemo } from 'react';

import { Chip } from '@/components/Chip';
import { TextEllipsis } from '@/components/Ellipsis';
import type { TableColumnDef } from '@/components/Table';
import { RichTable } from '@/core/components';
import type { FilterBarProps, RichTablePagination, TableSearchProps } from '@/core/components';
import { useTranslation } from '@/core/locales';
import { formatDateTime } from '@/shared/date';

import { describeTrigger } from '../../../components/triggerSummary';
import { ANNOUNCEMENT_STATUS_LABEL_KEY, ANNOUNCEMENT_STATUS_TONE } from '../../../constants';
import { AnnouncementDetailRoute } from '../../../routes';
import type { AnnouncementSearchQuery } from '../../../routes';
import type { AnnouncementRowVM } from '../adapter';

export type AnnouncementFilterValues = { status?: AnnouncementSearchQuery['status'] };

interface AnnouncementTableProps {
  rows: AnnouncementRowVM[];
  loading: boolean;
  search: AnnouncementSearchQuery;
  onRowDoubleClick: (row: AnnouncementRowVM) => void;
  searchBox: TableSearchProps;
  filters: FilterBarProps<AnnouncementFilterValues>;
  error: unknown;
  onRetry: () => void;
  pagination: RichTablePagination;
}

export function AnnouncementTable({
  rows,
  loading,
  search,
  onRowDoubleClick,
  searchBox,
  filters,
  error,
  onRetry,
  pagination,
}: AnnouncementTableProps) {
  const { t, language } = useTranslation();

  const columns = useMemo<Array<TableColumnDef<AnnouncementRowVM>>>(
    () => [
      {
        id: 'title',
        header: t('announcement.field.title'),
        enableSorting: false,
        cell: ({ row }) => (
          <Link
            to={AnnouncementDetailRoute.to}
            params={{ announcementId: row.original.id }}
            search={search}
            className="font-medium text-[var(--color-brand)]"
            data-testid="announcement-title-link"
          >
            <TextEllipsis className="max-w-80">{row.original.title}</TextEllipsis>
          </Link>
        ),
      },
      {
        id: 'status',
        header: t('announcement.field.status'),
        enableSorting: false,
        cell: ({ row }) => (
          <Chip
            tone={ANNOUNCEMENT_STATUS_TONE[row.original.status]}
            data-testid="announcement-status"
            data-value={row.original.status}
          >
            {t(ANNOUNCEMENT_STATUS_LABEL_KEY[row.original.status])}
          </Chip>
        ),
      },
      {
        id: 'trigger',
        header: t('announcement.field.trigger'),
        enableSorting: false,
        cell: ({ row }) => describeTrigger(t, language, row.original.trigger),
      },
      {
        id: 'nextRunAt',
        header: t('announcement.field.nextRunAt'),
        enableSorting: false,
        cell: ({ row }) => (row.original.nextRunAt ? formatDateTime(row.original.nextRunAt) : '-'),
      },
      {
        id: 'read',
        header: t('announcement.field.readSummary'),
        enableSorting: false,
        cell: ({ row }) =>
          row.original.readSummary ? t('announcement.readSummary', row.original.readSummary) : '-',
      },
      {
        id: 'updatedAt',
        header: t('announcement.field.updatedAt'),
        enableSorting: false,
        cell: ({ row }) => formatDateTime(row.original.updatedAt),
      },
    ],
    [language, search, t],
  );

  return (
    <RichTable
      data={rows}
      columns={columns}
      loading={loading}
      getRowId={getRowId}
      enableRowSelection={false}
      search={searchBox}
      filters={filters}
      error={error}
      onRetry={onRetry}
      pagination={pagination}
      onRowDoubleClick={onRowDoubleClick}
      data-testid="announcement-table"
    />
  );
}

const getRowId = (row: AnnouncementRowVM) => row.id;
