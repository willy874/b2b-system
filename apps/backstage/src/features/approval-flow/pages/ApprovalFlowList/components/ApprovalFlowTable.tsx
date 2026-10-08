import { Chip } from '@b2b-system/ui/Chip';
import type { TableColumnDef } from '@b2b-system/ui/Table';
import { RichTable } from '@b2b-system/web-core/components';
import { useTranslation } from '@b2b-system/web-core/locales';
import { Link } from '@tanstack/react-router';
import { useMemo } from 'react';

import {
  APPROVAL_FLOW_STATUS_LABEL_KEY,
  APPROVAL_FLOW_STATUS_TONE,
  APPROVAL_FLOW_TYPE_LABEL_KEY,
} from '../../../constants';
import { ApprovalFlowEditRoute } from '../../../routes';
import type { ApprovalFlowRowVM } from '../adapter';

interface ApprovalFlowTableProps {
  rows: ApprovalFlowRowVM[];
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  onRowDoubleClick: (row: ApprovalFlowRowVM) => void;
}

export function ApprovalFlowTable({
  rows,
  loading,
  error,
  onRetry,
  onRowDoubleClick,
}: ApprovalFlowTableProps) {
  const { t } = useTranslation();

  const columns = useMemo<Array<TableColumnDef<ApprovalFlowRowVM>>>(
    () => [
      {
        id: 'type',
        header: t('approvalFlow.list.column.type'),
        enableSorting: false,
        cell: ({ row }) => {
          const labelKey = APPROVAL_FLOW_TYPE_LABEL_KEY[row.original.type];
          return (
            <Link
              to={ApprovalFlowEditRoute.to}
              params={{ type: row.original.type }}
              className="font-medium text-[var(--color-brand)]"
              data-testid="approval-flow-type-link"
              data-value={row.original.type}
            >
              {labelKey ? t(labelKey) : row.original.type}
            </Link>
          );
        },
      },
      {
        id: 'status',
        header: t('approvalFlow.list.column.status'),
        enableSorting: false,
        cell: ({ row }) => (
          <span className="flex items-center gap-1">
            <Chip
              tone={APPROVAL_FLOW_STATUS_TONE[row.original.status]}
              data-testid="approval-flow-status"
              data-value={row.original.status}
            >
              {t(APPROVAL_FLOW_STATUS_LABEL_KEY[row.original.status])}
            </Chip>
            {row.original.hasAssigneeIssue && (
              <Chip tone="danger" data-testid="approval-flow-assignee-issue">
                {t('approvalFlow.list.assigneeIssue')}
              </Chip>
            )}
          </span>
        ),
      },
      {
        id: 'steps',
        header: t('approvalFlow.list.column.steps'),
        enableSorting: false,
        cell: ({ row }) =>
          row.original.stepNames.length > 0 ? (
            <span data-testid="approval-flow-steps">{row.original.stepNames.join(' → ')}</span>
          ) : (
            '-'
          ),
      },
      {
        id: 'version',
        header: t('approvalFlow.list.column.version'),
        enableSorting: false,
        cell: ({ row }) => row.original.version ?? '-',
      },
    ],
    [t],
  );

  return (
    <RichTable
      data={rows}
      columns={columns}
      loading={loading}
      getRowId={getRowId}
      enableRowSelection={false}
      error={error}
      onRetry={onRetry}
      onRowDoubleClick={onRowDoubleClick}
      data-testid="approval-flow-table"
    />
  );
}

const getRowId = (row: ApprovalFlowRowVM) => row.type;
