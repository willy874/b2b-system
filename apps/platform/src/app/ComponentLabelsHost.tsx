import { useMemo } from 'react';
import type { ReactNode } from 'react';

import { ComponentLabelsContext } from '@/components/labels';
import type { ComponentLabels } from '@/components/labels';
import { useTranslation } from '@/core/locales';

/**
 * 設計系統元件的預設文案改用目前語系：`components/` 不依賴語系，由這裡以 `t()` 傳入
 * 切換語系時 `t` 換新，文案跟著更新。
 */
export function ComponentLabelsHost({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const labels = useMemo<ComponentLabels>(
    () => ({
      required: t('components.required'),
      selectSearch: t('components.selectSearch'),
      selectNoMatch: t('components.selectNoMatch'),
      selectLoading: t('common.loading'),
      selectAll: t('components.selectAll'),
      toastClose: t('common.close'),
      paginationNav: t('components.pagination.nav'),
      paginationPageSize: t('components.pagination.pageSize'),
      paginationFirst: t('components.pagination.first'),
      paginationLast: t('components.pagination.last'),
      paginationPrevious: t('common.previous'),
      paginationNext: t('common.next'),
      paginationPage: t('components.pagination.page'),
    }),
    [t],
  );
  return <ComponentLabelsContext value={labels}>{children}</ComponentLabelsContext>;
}
