/**
 * 「某個租戶的這份快取作廢」的廣播訊息（資料夾樹、系統設定）：以租戶為單位快取的東西，失效時只需要租戶 id。
 * 其他程序收到後丟掉那個租戶的快取，下一次讀取重新查（docs/architecture/06-external-api.md §9.2 D16）。
 */
export interface TenantInvalidation {
  tenant: string;
}

/** `BroadcastChannelSubscriber.parse` 用。 */
export function parseTenantInvalidation(value: unknown): TenantInvalidation | null {
  if (typeof value !== 'object' || value === null) return null;
  const { tenant } = value as Partial<TenantInvalidation>;
  return typeof tenant === 'string' ? { tenant } : null;
}
