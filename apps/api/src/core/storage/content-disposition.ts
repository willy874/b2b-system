/**
 * 組出 `Content-Disposition`（RFC 6266）：`filename` 放 ASCII 的退路，
 * `filename*` 放 UTF-8 的完整檔名（RFC 5987），中文檔名下載時才不會變亂碼。
 */
export function contentDisposition(disposition: 'inline' | 'attachment', fileName: string): string {
  const fallback = fileName.replaceAll(/[^\x20-\x7e]/g, '_').replaceAll(/["\\]/g, '_');
  const encoded = encodeURIComponent(fileName).replaceAll(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${disposition}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
