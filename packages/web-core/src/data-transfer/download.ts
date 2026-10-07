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
