import { useTranslation } from '@b2b-system/web-core/locales';
import { cn } from '@b2b-system/web-shared/utils';
import { useMemo } from 'react';

import type { GalleryTimeline as GalleryTimelineData } from '@/shared/api-sdk';

import { monthStart } from '../sections';

interface GalleryTimelineProps {
  timeline: GalleryTimelineData | undefined;
  /** 目前最上方的區段所在的月份（`YYYY-MM`）。 */
  activeMonth: string | undefined;
  onJump: (month: string) => void;
}

/**
 * 右側的日期捲軸（docs/architecture/frontend/24-gallery.md §3）：每個月一格，高度依張數比例分配；
 * 點一個月就以那個月為起點重新載入列表（`startAt`），不必一路捲過去。
 */
export function GalleryTimeline({ timeline, activeMonth, onJump }: GalleryTimelineProps) {
  const { t, language } = useTranslation();
  const months = timeline?.months ?? [];
  const total = months.reduce((sum, month) => sum + month.count, 0);
  const format = useMemo(
    () => new Intl.DateTimeFormat(language, { year: 'numeric', month: 'short' }),
    [language],
  );
  if (months.length < 2) return null;
  return (
    <nav
      aria-label={t('gallery.timeline.label')}
      className="hidden w-20 shrink-0 flex-col overflow-y-auto text-xs md:flex"
      data-testid="gallery-timeline"
    >
      {months.map((month) => (
        <button
          key={month.month}
          type="button"
          className={cn(
            'min-h-6 cursor-pointer border-0 border-l-2 border-transparent bg-transparent px-2 text-left text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]',
            activeMonth === month.month && 'border-[var(--color-brand)] text-[var(--color-fg)]',
          )}
          // 依張數比例分配高度（連續的值，允許 inline style）
          style={{ flexGrow: total > 0 ? month.count / total : 1 }}
          aria-current={activeMonth === month.month ? 'true' : undefined}
          title={t('gallery.timeline.count', { count: month.count })}
          onClick={() => onJump(month.month)}
          data-testid="gallery-timeline-month"
          data-value={month.month}
        >
          {format.format(monthStart(month.month))}
        </button>
      ))}
    </nav>
  );
}
