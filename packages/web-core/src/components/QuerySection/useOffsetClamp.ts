import { useEffect } from 'react';

/**
 * 區塊裡自己分頁的清單：刪到最後一頁沒有資料時（`offset` 超過總數）退回最後一頁，與 `RichTable` 相同。
 * 不夾的話，移除最後一頁唯一的一筆會停在空頁，而總數剛好等於一頁時分頁也消失，沒有出路。
 *
 * @param total 查詢結果的總數；載入中、失敗時傳 `undefined`（不動）
 */
export function useOffsetClamp(
  total: number | undefined,
  offset: number,
  limit: number,
  setOffset: (offset: number) => void,
): void {
  const clamped =
    total !== undefined && offset > 0 && offset >= total
      ? Math.max(0, Math.floor((total - 1) / limit) * limit)
      : undefined;
  useEffect(() => {
    if (clamped !== undefined) setOffset(clamped);
  }, [clamped, setOffset]);
}
