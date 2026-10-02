/** 送出前整理網址清單：去掉前後空白與空白列（docs/architecture/backend/17-webhook.md §10.2 D13）。 */
export function cleanUrls(urls: readonly string[]): string[] {
  return urls.map((url) => url.trim()).filter(Boolean);
}
