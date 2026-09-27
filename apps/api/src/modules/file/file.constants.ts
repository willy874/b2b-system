/** 稽核 `file.update` 時比對的欄位。 */
export const FILE_AUDIT_FIELDS = ['name'] as const;

/**
 * 物件儲存的 key 只由 id 決定，與使用者給的檔名無關：
 * 改名不必搬物件，也不會有編碼、重名、路徑穿越的問題。
 */
export function storageKeyOf(fileId: string): string {
  return `files/${fileId}`;
}
