/**
 * 反覆刪一批，直到某一批不滿（沒有更多可刪的列），回傳總筆數。保留清理的排程共用
 * （token、站內通知、平台通知、webhook 事件；docs/architecture/backend/04-auth.md §8、15-notification.md §5）。
 *
 * - 每批一個語句、各自提交：批與批之間讓出鎖，線上的寫入不會被長時間擋住；中途失敗重跑只剩還沒刪的。
 * - 依序執行，不並行：同時刪只會互搶鎖。
 *
 * `deleteBatch(batchSize)` 刪掉至多 `batchSize` 列並回傳實際刪掉的筆數（需要逐批做別的事，例如推播，也在裡面做）。
 */
export async function deleteInBatches(
  deleteBatch: (batchSize: number) => Promise<number>,
  batchSize: number,
): Promise<number> {
  let total = 0;
  for (;;) {
    // oxlint-disable-next-line no-await-in-loop -- 見上：一批提交了才刪下一批
    const deleted = await deleteBatch(batchSize);
    total += deleted;
    if (deleted < batchSize) return total;
  }
}
