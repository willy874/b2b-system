import { Pagination } from '@/components/Pagination';
import { Table } from '@/components/Table';
import type { TableProps } from '@/components/Table';
import { useTranslation } from '@/core/locales';
import { cn } from '@/shared/utils';

/** 伺服器端分頁的狀態；與 `Pagination` 相同，換頁或改每頁筆數時回報新的 `offset` / `limit`。 */
export interface RichTablePagination {
  offset: number;
  limit: number;
  total: number;
  onChange: (next: { offset: number; limit: number }) => void;
  pageSizeOptions?: number[];
}

export interface RichTableProps<TData> extends Omit<
  TableProps<TData>,
  'ref' | 'className' | 'classNames' | 'styles' | 'testIds' | 'data-testid'
> {
  /** 不提供時不顯示分頁列（例如資料量固定的小表格）。 */
  pagination?: RichTablePagination;
  /** 落在最外層容器。 */
  className?: string;
  /** 落在最外層容器；表格與分頁列各自保留設計系統的預設 testid。 */
  'data-testid'?: string;
}

/**
 * 列表頁用的表格：把 `Table` 與 `Pagination` 組在一起，並以目前語系補上空狀態與分頁的預設文案。
 * 放在 `core/` 而不是 `components/`，因為它依賴 `core/locales`（docs/conventions/02-frontend.md §8）；
 * 之後的篩選列（FilterBar）與欄位設定（Setting）也會整合到這裡。
 */
export function RichTable<TData>({
  pagination,
  emptyTitle,
  className,
  'data-testid': testId,
  ...tableProps
}: RichTableProps<TData>) {
  const { t } = useTranslation();

  return (
    <div className={cn('flex flex-col gap-4', className)} data-testid={testId}>
      <Table {...tableProps} emptyTitle={emptyTitle ?? t('common.empty')} />

      {pagination && (
        <Pagination
          offset={pagination.offset}
          limit={pagination.limit}
          total={pagination.total}
          onChange={pagination.onChange}
          pageSizeOptions={pagination.pageSizeOptions}
          labels={{
            previous: t('common.previous'),
            next: t('common.next'),
            summary: ({ from, to, total }) => `${from}-${to} / ${total}`,
          }}
        />
      )}
    </div>
  );
}
