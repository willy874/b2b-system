/** 一批刪幾列：每批一個語句，批與批之間讓出鎖，續期與登入不會被長時間擋住。 */
export const TOKEN_CLEANUP_BATCH_SIZE = 5_000;

/**
 * 反覆刪一批，直到某一批不滿（沒有更多可刪的列）。回傳總筆數。
 * 租戶與平台的 token 清理共用（docs/architecture/backend/04-auth.md §8）。
 */
export async function deleteInBatches(
  deleteBatch: (batchSize: number) => Promise<number>,
  batchSize = TOKEN_CLEANUP_BATCH_SIZE,
): Promise<number> {
  let total = 0;
  for (;;) {
    // 刻意依序執行：同時刪只會互搶鎖
    // oxlint-disable-next-line no-await-in-loop -- 見上一行
    const deleted = await deleteBatch(batchSize);
    total += deleted;
    if (deleted < batchSize) return total;
  }
}
