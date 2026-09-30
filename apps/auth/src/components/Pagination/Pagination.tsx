import { useState } from 'react';
import type { Ref } from 'react';

import { cn } from '@/shared/utils';

import { Button } from '../Button';
import { useComponentLabels } from '../labels';
import { Select } from '../Select';
import { createSlots } from '../slots';
import type { SlotOverrides } from '../slots';

import styles from './Pagination.module.css';

/** `className` 落在根元素（`<nav>`）；其餘各層用 `classNames` / `styles` / `testIds` 覆寫。 */
export type PaginationSlot =
  | 'summary'
  | 'controls'
  | 'pageSize'
  | 'first'
  | 'previous'
  | 'page'
  | 'next'
  | 'last';

export interface PaginationLabels {
  previous?: string;
  next?: string;
  first?: string;
  last?: string;
  /** `<nav>` 的名稱。 */
  nav?: string;
  /** 每頁筆數下拉的名稱。 */
  pageSize?: string;
  /** 跳頁輸入框的名稱。 */
  page?: string;
  summary?: (info: PaginationSummary) => string;
}

export interface PaginationProps extends SlotOverrides<PaginationSlot> {
  /** 透傳到根元素（React 19 的 ref 是一般 prop）。 */
  ref?: Ref<HTMLElement>;
  offset: number;
  limit: number;
  total: number;
  onChange: (next: { offset: number; limit: number }) => void;
  pageSizeOptions?: number[];
  /** 沒傳的文案用 `ComponentLabelsContext`（目前語系）。 */
  labels?: PaginationLabels;
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

/**
 * 伺服器端分頁：第一頁／上一頁／可輸入的頁碼／下一頁／最後一頁，
 * 千筆資料也能一步跳到任一頁（docs/issues/04-user-experience.md UX-22）。
 */
export function Pagination({
  offset,
  limit,
  total,
  onChange,
  pageSizeOptions = DEFAULT_PAGE_SIZES,
  labels,
  className,
  classNames,
  styles: styleOverrides,
  testIds,
  ...rest
}: PaginationProps) {
  const slot = createSlots({ classNames, styles: styleOverrides, testIds });
  const defaults = useComponentLabels();
  const pageCount = Math.max(1, Math.ceil(total / limit));
  const page = Math.floor(offset / limit) + 1;
  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + limit, total);

  const summary = labels?.summary
    ? labels.summary({ from, to, total, page, pageCount })
    : `${from}-${to} / ${total}`;
  const goTo = (target: number) => {
    const clamped = Math.min(Math.max(1, target), pageCount);
    if (clamped !== page) onChange({ offset: (clamped - 1) * limit, limit });
  };

  return (
    <nav
      className={cn(styles.root, className)}
      aria-label={labels?.nav ?? defaults.paginationNav}
      {...rest}
    >
      <span {...slot('summary', undefined, { testId: 'pagination-summary' })}>{summary}</span>
      <div {...slot('controls', styles.controls)}>
        <Select
          size="sm"
          value={String(limit)}
          onValueChange={(value) => onChange({ offset: 0, limit: Number(value) })}
          options={pageSizeOptions.map((size) => ({ value: String(size), label: String(size) }))}
          aria-label={labels?.pageSize ?? defaults.paginationPageSize}
          {...slot('pageSize', styles.pageSize)}
        />
        <Button
          size="sm"
          disabled={page <= 1}
          onClick={() => goTo(1)}
          {...slot('first', undefined, { testId: 'pagination-first' })}
        >
          {labels?.first ?? defaults.paginationFirst}
        </Button>
        <Button
          size="sm"
          disabled={page <= 1}
          onClick={() => onChange({ offset: Math.max(0, offset - limit), limit })}
          {...slot('previous', undefined, { testId: 'pagination-prev' })}
        >
          {labels?.previous ?? defaults.paginationPrevious}
        </Button>
        <span {...slot('page', styles.page)}>
          {/* key：外部換頁時重設輸入框的草稿 */}
          <PageInput
            key={page}
            page={page}
            pageCount={pageCount}
            label={labels?.page ?? defaults.paginationPage}
            onCommit={goTo}
          />
          <span aria-hidden> / {pageCount}</span>
        </span>
        <Button
          size="sm"
          disabled={page >= pageCount}
          onClick={() => onChange({ offset: offset + limit, limit })}
          {...slot('next', undefined, { testId: 'pagination-next' })}
        >
          {labels?.next ?? defaults.paginationNext}
        </Button>
        <Button
          size="sm"
          disabled={page >= pageCount}
          onClick={() => goTo(pageCount)}
          {...slot('last', undefined, { testId: 'pagination-last' })}
        >
          {labels?.last ?? defaults.paginationLast}
        </Button>
      </div>
    </nav>
  );
}

interface PageInputProps {
  page: number;
  pageCount: number;
  label: string;
  onCommit: (page: number) => void;
}

/** 輸入頁碼後按 Enter 或離開欄位才跳頁；打到一半不會觸發查詢。 */
function PageInput({ page, pageCount, label, onCommit }: PageInputProps) {
  const [draft, setDraft] = useState(String(page));
  const commit = () => {
    const target = Number.parseInt(draft, 10);
    if (Number.isNaN(target)) setDraft(String(page));
    else onCommit(target);
  };
  return (
    <input
      className={styles.pageInput}
      type="number"
      inputMode="numeric"
      min={1}
      max={pageCount}
      value={draft}
      aria-label={label}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') commit();
      }}
      data-testid="pagination-page-input"
    />
  );
}
