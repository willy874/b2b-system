/**
 * 過期 token 的清理一批刪幾列（租戶與平台的 token 清理共用，docs/architecture/backend/04-auth.md §8）：
 * 每批一個語句，批與批之間讓出鎖，續期與登入不會被長時間擋住。
 */
export const TOKEN_CLEANUP_BATCH_SIZE = 5_000;
