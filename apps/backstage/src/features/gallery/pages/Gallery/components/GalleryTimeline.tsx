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

type TimelineMonth = GalleryTimelineData['months'][number];

/** 依年份分段（API 回的月份已依時間排好，相鄰的同一年才合併）。 */
function groupByYear(months: readonly TimelineMonth[]) {
  const years: Array<{ year: string; months: TimelineMonth[] }> = [];
  for (const month of months) {
    const year = month.month.slice(0, 4);
    const last = years.at(-1);
    if (last?.year === year) last.months.push(month);
    else years.push({ year, months: [month] });
  }
  return years;
}

/**
 * 右側的日期捲軸（docs/architecture/frontend/24-gallery.md §3）：依年份分段，每個月一格，高度依張數比例分配；
 * 點一個月就以那個月為起點重新載入列表（`startAt`），不必一路捲過去。
 * 年份只寫在段首、月份只寫月：「2025年12月」在窄欄裡會折成兩行，壓到下一格。月份多到放不下時整欄捲動，不壓縮格子。
 */
export function GalleryTimeline({ timeline, activeMonth, onJump }: GalleryTimelineProps) {
  const { t, language } = useTranslation();
  const months = useMemo(() => timeline?.months ?? [], [timeline]);
  const years = useMemo(() => groupByYear(months), [months]);
  const total = months.reduce((sum, month) => sum + month.count, 0);
  const monthFormat = useMemo(
    () => new Intl.DateTimeFormat(language, { month: 'short' }),
    [language],
  );
  const yearFormat = useMemo(
    () => new Intl.DateTimeFormat(language, { year: 'numeric' }),
    [language],
  );
  // 報讀器念完整的年月：畫面上的月份只寫月，年份在段首
  const labelFormat = useMemo(
    () => new Intl.DateTimeFormat(language, { year: 'numeric', month: 'long' }),
    [language],
  );
  if (months.length < 2) return null;
  return (
    <nav
      aria-label={t('gallery.timeline.label')}
      className="hidden w-16 shrink-0 flex-col overflow-y-auto overflow-x-hidden text-xs md:flex"
      data-testid="gallery-timeline"
    >
      {years.map((group) => (
        <div
          key={group.year}
          className="flex shrink-0 flex-col"
          // 依張數比例分配高度（連續的值，允許 inline style）
          style={{
            flexGrow:
              total > 0
                ? group.months.reduce((sum, month) => sum + month.count, 0) / total
                : group.months.length,
          }}
          data-testid="gallery-timeline-year"
          data-value={group.year}
        >
          <span className="sticky top-0 shrink-0 bg-[var(--color-bg)] px-2 py-1 font-semibold whitespace-nowrap text-[var(--color-fg)]">
            {yearFormat.format(monthStart(group.months[0]?.month ?? `${group.year}-01`))}
          </span>
          {group.months.map((month) => (
            <button
              key={month.month}
              type="button"
              className={cn(
                'min-h-6 shrink-0 cursor-pointer border-0 border-l-2 border-transparent bg-transparent px-2 text-left whitespace-nowrap text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]',
                activeMonth === month.month && 'border-[var(--color-brand)] text-[var(--color-fg)]',
              )}
              // 依張數比例分配段內的高度（連續的值，允許 inline style）
              style={{ flexGrow: month.count }}
              aria-label={labelFormat.format(monthStart(month.month))}
              aria-current={activeMonth === month.month ? 'true' : undefined}
              title={t('gallery.timeline.count', { count: month.count })}
              onClick={() => onJump(month.month)}
              data-testid="gallery-timeline-month"
              data-value={month.month}
            >
              {monthFormat.format(monthStart(month.month))}
            </button>
          ))}
        </div>
      ))}
    </nav>
  );
}
