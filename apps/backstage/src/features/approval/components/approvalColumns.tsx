import { Chip } from '@b2b-system/ui/Chip';
import type { TableColumnDef } from '@b2b-system/ui/Table';
import { formatDateTime } from '@b2b-system/web-shared/date';
import type { ReactNode } from 'react';

import type { ApprovalRequest } from '@/shared/api-sdk';

import {
  APPROVAL_STATUS_LABEL_KEY,
  APPROVAL_STATUS_TONE,
  APPROVAL_TYPE_LABEL_KEY,
} from '../constants';
import { ApprovalProgress } from './ApprovalProgress';

/** 審批列表（全部的審批、我的審批）共用欄位需要的資料。 */
export interface ApprovalColumnRow {
  id: string;
  type: ApprovalRequest['type'];
  status: ApprovalRequest['status'];
  requesterName: string;
  createdAt: Date;
  progress: ApprovalRequest['currentStep'];
  stepCount: number;
}

interface ApprovalColumnOptions<Row extends ApprovalColumnRow> {
  t: (key: string, options?: Record<string, unknown>) => string;
  /** 類型欄的詳情連結：兩個列表連到不同的路由（route 的 `to` 要寫字面量），由呼叫端渲染。 */
  renderTypeLink: (row: Row, label: string) => ReactNode;
  /** 狀態 Chip 的 testid（完整字面量，docs/coding-standards/06-literal-strings.md §3.3）。 */
  statusTestId: string;
  /** 建立時間可以排序（全部的審批有排序；我的審批沒有）。 */
  createdAtSortable?: boolean;
}

/**
 * 兩個審批列表相同的欄位：類型（連到詳情）、申請人、進度、狀態、建立時間。呼叫端決定順序並加上自己的欄位
 * （審核者、審核時間、快速審核）。
 */
export function approvalColumns<Row extends ApprovalColumnRow>({
  t,
  renderTypeLink,
  statusTestId,
  createdAtSortable = false,
}: ApprovalColumnOptions<Row>) {
  return {
    type: {
      id: 'type',
      header: t('approval.field.type'),
      enableSorting: false,
      cell: ({ row }) =>
        renderTypeLink(row.original, t(APPROVAL_TYPE_LABEL_KEY[row.original.type])),
    },
    requesterName: {
      id: 'requesterName',
      header: t('approval.field.requester'),
      enableSorting: false,
      cell: ({ row }) => row.original.requesterName,
    },
    progress: {
      id: 'progress',
      header: t('approval.field.progress'),
      enableSorting: false,
      cell: ({ row }) => <ApprovalProgress row={row.original} />,
    },
    status: {
      id: 'status',
      header: t('approval.field.status'),
      enableSorting: false,
      cell: ({ row }) => (
        <Chip
          tone={APPROVAL_STATUS_TONE[row.original.status]}
          data-testid={statusTestId}
          data-value={row.original.status}
        >
          {t(APPROVAL_STATUS_LABEL_KEY[row.original.status])}
        </Chip>
      ),
    },
    createdAt: {
      id: 'createdAt',
      header: t('approval.field.createdAt'),
      enableSorting: createdAtSortable,
      cell: ({ row }) => formatDateTime(row.original.createdAt),
    },
  } satisfies Record<string, TableColumnDef<Row>>;
}
