/** 送出前整理網址清單：去掉前後空白與空白列（docs/adr/0033-feature-params-and-webhook-targets.md D13）。 */
export function cleanUrls(urls: readonly string[]): string[] {
  return urls.map((url) => url.trim()).filter(Boolean);
}
