/**
 * 以 `<a download>` 觸發瀏覽器下載（docs/architecture/backend/22-data-transfer.md §8.2）：匯出檔的 presigned 連結、
 * 檔案管理的下載都用它。連結本身帶 `Content-Disposition: attachment`，不會開新頁。
 */
export function downloadFromUrl(url: string, fileName: string): void {
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = 'noopener';
  anchor.style.display = 'none';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}

/** 多個下載之間的間隔：同一瞬間觸發多個下載，瀏覽器只會處理第一個。 */
export const DOWNLOAD_INTERVAL_MS = 250;

/** 一次最多依序觸發幾個下載（再多就該打包下載）。 */
export const DOWNLOAD_MAX = 50;

/** 要下載的目標；`fileName` 空字串時用伺服器的 `Content-Disposition` 檔名。 */
export interface DownloadTarget {
  url: string;
  fileName: string;
}

export interface DownloadSequentiallyOptions<T> {
  /** 取得下載網址（例：先查詳情拿簽好的網址）；回 `undefined` 的項目略過。 */
  resolve: (item: T) => DownloadTarget | undefined | Promise<DownloadTarget | undefined>;
  /** 預設 `DOWNLOAD_MAX`。 */
  max?: number;
  /** 預設 `DOWNLOAD_INTERVAL_MS`。 */
  intervalMs?: number;
  /** 超過上限時呼叫一次（只下載前 `max` 個），由呼叫端提示使用者。 */
  onLimited?: (max: number) => void;
}

/**
 * 在目前的分頁依序觸發多個下載：一次一個、每個之間隔 `intervalMs`、最多 `max` 個
 * （瀏覽器只讓前景的分頁觸發下載，同一瞬間觸發多個只會處理第一個）。檔案管理與圖片庫的多選下載共用。
 */
export async function downloadSequentially<T>(
  items: readonly T[],
  {
    resolve,
    max = DOWNLOAD_MAX,
    intervalMs = DOWNLOAD_INTERVAL_MS,
    onLimited,
  }: DownloadSequentiallyOptions<T>,
): Promise<void> {
  if (items.length > max) onLimited?.(max);
  let triggered = 0;
  for (const item of items.slice(0, max)) {
    // oxlint-disable-next-line no-await-in-loop -- 一個一個觸發：同時觸發會被瀏覽器擋下
    const target = await resolve(item);
    if (!target) continue;
    if (triggered > 0) {
      // oxlint-disable-next-line no-await-in-loop -- 同上
      await new Promise((done) => setTimeout(done, intervalMs));
    }
    downloadFromUrl(target.url, target.fileName);
    triggered += 1;
  }
}

/** 把已經取得的內容（範本、結果報告）存成檔案。 */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  try {
    downloadFromUrl(url, fileName);
  } finally {
    // 等瀏覽器開始下載再釋放
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}
