import type { FilterBarProps } from '@b2b-system/web-core/components';
import { useTranslation } from '@b2b-system/web-core/locales';

import type { Tag } from '@/shared/api-sdk';

import { FILE_CATEGORIES, FILE_CATEGORY_LABEL_KEY } from '../../constants';
import type { FileSearchQuery } from '../../routes';

export type FileFilterValues = Pick<FileSearchQuery, 'keyword' | 'category' | 'tag'>;

const EMPTY_FILTERS: FileFilterValues = { keyword: undefined, category: undefined, tag: undefined };

/**
 * 篩選面板：分類、標籤。送出時一次寫進網址。
 * 關鍵字由工具列常駐的搜尋框輸入，仍保留在 value 裡：面板送出與移除條件時一起帶上。
 */
export function useFileFilters(
  search: FileFilterValues,
  setFilters: (filters: FileFilterValues) => void,
  /** `file` 標籤組的標籤；還沒載入或沒有任何標籤時不顯示標籤篩選。 */
  tags: readonly Tag[] = [],
): FilterBarProps<FileFilterValues> {
  const { t } = useTranslation();
  return {
    value: { keyword: search.keyword, category: search.category, tag: search.tag },
    defaultValue: EMPTY_FILTERS,
    onSubmit: setFilters,
    fields: [
      {
        type: 'select',
        key: 'category',
        label: t('file.field.category'),
        allLabel: t('file.category.all'),
        options: FILE_CATEGORIES.map((value) => ({
          value,
          label: t(FILE_CATEGORY_LABEL_KEY[value]),
        })),
      },
      ...(tags.length
        ? [
            {
              type: 'multiSelect' as const,
              key: 'tag' as const,
              label: t('tag.filter'),
              options: tags.map((tag) => ({ value: tag.id, label: tag.name })),
            },
          ]
        : []),
    ],
  };
}
