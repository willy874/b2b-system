import { Chip } from '@b2b-system/ui/Chip';
import { useTranslation } from '@b2b-system/web-core/locales';
import { cn, formatList } from '@b2b-system/web-shared/utils';
import type { ReactNode } from 'react';

import type { TagSummary } from '@/shared/api-sdk';

export interface TagChipsProps {
  tags: readonly TagSummary[];
  /** 沒有標籤時顯示（例：`-`）；不給就不顯示任何東西。 */
  empty?: ReactNode;
  /** 只顯示前幾個，其餘收成 `+N`（列表的窄欄位用）。 */
  max?: number;
  className?: string;
  'data-testid'?: string;
}

/**
 * 一列標籤（docs/architecture/backend/18-tag.md §7.2 D3）：顏色是 Design Token 的名稱，直接對到 `Chip` 的 tone。
 * 每個標籤是 `data-testid="tag-chip"`、`data-value=<標籤 id>`。
 */
export function TagChips({ tags, empty, max, className, 'data-testid': testId }: TagChipsProps) {
  const { language } = useTranslation();
  if (!tags.length) return empty ?? null;
  const shown = max === undefined ? tags : tags.slice(0, max);
  const hidden = tags.length - shown.length;
  return (
    <span
      className={cn('inline-flex flex-wrap items-center gap-1', className)}
      data-testid={testId}
    >
      {shown.map((tag) => (
        <Chip key={tag.id} tone={tag.color} data-testid="tag-chip" data-value={tag.id}>
          {tag.name}
        </Chip>
      ))}
      {hidden > 0 && (
        <span
          className="text-xs text-[var(--color-fg-muted)]"
          title={formatList(
            tags.slice(shown.length).map((tag) => tag.name),
            language,
          )}
          data-testid="tag-chip-more"
        >
          +{hidden}
        </span>
      )}
    </span>
  );
}
