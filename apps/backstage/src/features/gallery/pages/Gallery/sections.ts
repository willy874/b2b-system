import type { GalleryItem } from '@/shared/api-sdk';

import type { GalleryGrouping } from './preference';

/** 一個日期區段：標題黏在上方（docs/architecture/frontend/24-gallery.md §3）。 */
export interface GallerySection {
  /** `YYYY-MM-DD`、`YYYY-MM`，不分組時是 `all`。 */
  key: string;
  /** 區段第一天的當地時間（標題的格式化、「選取這一天」用）。 */
  date: Date | null;
  items: GalleryItem[];
}

const pad = (value: number) => String(value).padStart(2, '0');

/** 依瀏覽器的時區取日或月的 key。 */
export function sectionKeyOf(date: Date, grouping: Exclude<GalleryGrouping, 'none'>): string {
  const month = `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
  return grouping === 'month' ? month : `${month}-${pad(date.getDate())}`;
}

/**
 * 把已載入的圖片（已經依時間排好）切成日或月的區段；依標題排序或不分組時只有一段。
 * 相鄰的同一天才合併：列表本來就依時間排序，不必重新排。
 */
export function groupGalleryItems(
  items: readonly GalleryItem[],
  grouping: GalleryGrouping,
  timeField: 'sortAt' | 'createdAt' | null,
): GallerySection[] {
  if (grouping === 'none' || timeField === null) {
    return items.length > 0 ? [{ key: 'all', date: null, items: [...items] }] : [];
  }
  const sections: GallerySection[] = [];
  for (const item of items) {
    const date = new Date(item[timeField]);
    const key = sectionKeyOf(date, grouping);
    const last = sections.at(-1);
    if (last?.key === key) {
      last.items.push(item);
      continue;
    }
    const start =
      grouping === 'month'
        ? new Date(date.getFullYear(), date.getMonth(), 1)
        : new Date(date.getFullYear(), date.getMonth(), date.getDate());
    sections.push({ key, date: start, items: [item] });
  }
  return sections;
}

/** `YYYY-MM` 的月份 → 那個月第一天的當地時間。 */
export function monthStart(month: string): Date {
  const [year = 1970, value = 1] = month.split('-').map(Number);
  return new Date(year, value - 1, 1);
}

/**
 * 日期捲軸跳到某個月：列表從哪個時間開始載入。新到舊時是「下個月的第一天」（取 `< startAt`），
 * 舊到新時是「這個月的第一天」（取 `>= startAt`）。
 */
export function startAtForMonth(month: string, order: 'asc' | 'desc'): string {
  const start = monthStart(month);
  const target = order === 'desc' ? new Date(start.getFullYear(), start.getMonth() + 1, 1) : start;
  return target.toISOString();
}

/** `YYYY-MM-DD` → 那一天開始的當地時間。 */
function parseDay(value: string): Date {
  const [year = 1970, month = 1, day = 1] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

/** `YYYY-MM-DD`（瀏覽器的時區）→ ISO 的起點；`to` 是那一天的隔天（不含）。 */
export function dayRangeToIso(from: string | undefined, to: string | undefined) {
  const end = to ? parseDay(to) : undefined;
  end?.setDate(end.getDate() + 1);
  return {
    takenFrom: from ? parseDay(from).toISOString() : undefined,
    takenTo: end?.toISOString(),
  };
}
