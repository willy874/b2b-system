/**
 * 部署新版後，舊分頁 lazy 載入的舊 chunk 已經不在伺服器上。各瀏覽器的訊息不同：
 * Chrome「Failed to fetch dynamically imported module」、Firefox「error loading dynamically imported module」、
 * Safari「Importing a module script failed」；Vite 的 preload 失敗則是「Unable to preload CSS」。
 */
const CHUNK_ERROR_PATTERN =
  /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS/i;

/** lazy 載入的 chunk 不見了（部署了新版）：該提示重新整理，而不是重試。 */
export function isChunkLoadError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.name === 'ChunkLoadError' || CHUNK_ERROR_PATTERN.test(error.message);
}
