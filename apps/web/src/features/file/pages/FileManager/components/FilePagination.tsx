import { Pagination } from '@/components/Pagination';
import { useTranslation } from '@/core/locales';

import { FILE_PAGE_SIZES } from '../../../constants';

interface FilePaginationProps {
  offset: number;
  pageSize: number;
  total: number;
  onOffsetChange: (offset: number) => void;
  onPageSizeChange: (pageSize: number) => void;
}

/** 分頁模式的換頁列。改每頁筆數時回到第一頁（原本的 offset 在新的筆數下不一定對齊頁首）。 */
export function FilePagination({
  offset,
  pageSize,
  total,
  onOffsetChange,
  onPageSizeChange,
}: FilePaginationProps) {
  const { t } = useTranslation();
  return (
    <Pagination
      offset={offset}
      limit={pageSize}
      total={total}
      pageSizeOptions={[...FILE_PAGE_SIZES]}
      onChange={(next) => {
        if (next.limit !== pageSize) onPageSizeChange(next.limit);
        onOffsetChange(next.limit !== pageSize ? 0 : next.offset);
      }}
      labels={{
        previous: t('common.previous'),
        next: t('common.next'),
        summary: ({ from, to, total: count }) =>
          t('file.pagination.summary', { from, to, total: count }),
      }}
      data-testid="file-pagination"
    />
  );
}
