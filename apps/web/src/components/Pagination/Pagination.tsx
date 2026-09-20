import type { Ref } from 'react';

import { cn } from '@/shared/utils';

import { Button } from '../Button';
import { Select } from '../Select';

import './Pagination.css';

export interface PaginationProps {
  /** 透傳到根元素（React 19 的 ref 是一般 prop）。 */
  ref?: Ref<HTMLElement>;
  offset: number;
  limit: number;
  total: number;
  onChange: (next: { offset: number; limit: number }) => void;
  pageSizeOptions?: number[];
  labels?: { previous: string; next: string; summary: (info: PaginationSummary) => string };
  className?: string;
  'data-testid'?: string;
}

export interface PaginationSummary {
  from: number;
  to: number;
  total: number;
  page: number;
  pageCount: number;
}

const DEFAULT_PAGE_SIZES = [10, 20, 50, 100];

export function Pagination({
  offset,
  limit,
  total,
  onChange,
  pageSizeOptions = DEFAULT_PAGE_SIZES,
  labels,
  className,
  ...rest
}: PaginationProps) {
  const pageCount = Math.max(1, Math.ceil(total / limit));
  const page = Math.floor(offset / limit) + 1;
  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + limit, total);

  const summary = labels?.summary
    ? labels.summary({ from, to, total, page, pageCount })
    : `${from}-${to} / ${total}`;

  return (
    <nav className={cn('ge-pagination', className)} aria-label="pagination" {...rest}>
      <span className="ge-pagination__summary" data-testid="pagination-summary">
        {summary}
      </span>
      <div className="ge-pagination__controls">
        <Select
          size="sm"
          value={String(limit)}
          onValueChange={(value) => onChange({ offset: 0, limit: Number(value) })}
          options={pageSizeOptions.map((size) => ({ value: String(size), label: String(size) }))}
          aria-label="page size"
          className="ge-pagination__size"
        />
        <Button
          size="sm"
          disabled={page <= 1}
          onClick={() => onChange({ offset: Math.max(0, offset - limit), limit })}
          data-testid="pagination-prev"
        >
          {labels?.previous ?? '上一頁'}
        </Button>
        <span className="ge-pagination__page">
          {page} / {pageCount}
        </span>
        <Button
          size="sm"
          disabled={page >= pageCount}
          onClick={() => onChange({ offset: offset + limit, limit })}
          data-testid="pagination-next"
        >
          {labels?.next ?? '下一頁'}
        </Button>
      </div>
    </nav>
  );
}
