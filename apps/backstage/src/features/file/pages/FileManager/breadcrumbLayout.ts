/** 收進「…」的層：`[start, end)`，索引含根目錄（0 是「所有檔案」）。 */
export interface CollapsedRange {
  start: number;
  end: number;
}

/**
 * 麵包屑放不下時收合哪幾層：固定顯示根目錄與目前位置，其餘從目前位置往上、放得下幾層就顯示幾層，
 * 中間的收進「…」。全部放得下（或只有兩層、沒有中間可收）時回 `undefined`。
 *
 * @param widths 每一層（含它前面的分隔符號）的寬度，依根目錄 → 目前位置排列
 * @param ellipsisWidth 「…」那一層（含分隔符號）的寬度
 * @param available 麵包屑可用的寬度
 */
export function collapsedRange(
  widths: readonly number[],
  ellipsisWidth: number,
  available: number,
): CollapsedRange | undefined {
  const last = widths.length - 1;
  const total = widths.reduce((sum, width) => sum + width, 0);
  if (last < 2 || total <= available) return undefined;
  let used = (widths[0] ?? 0) + ellipsisWidth + (widths[last] ?? 0);
  let firstShown = last;
  // 至少收一層（索引 1），「…」才有東西可以展開
  while (firstShown - 1 > 1 && used + (widths[firstShown - 1] ?? 0) <= available) {
    firstShown -= 1;
    used += widths[firstShown] ?? 0;
  }
  return { start: 1, end: firstShown };
}
