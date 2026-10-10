/**
 * 批次佇列的項目 id 帶上第二個值（上傳的目的地資料夾或相簿、要貼的標籤）：佇列項目只能帶 id
 * （要能跨 worker、跨分頁傳遞），接手的分頁也知道要做什麼。uuid 與暫存 key 裡沒有 `@`。
 */
const SEPARATOR = '@';

export function pairItemId(first: string, second: string | null | undefined): string {
  return second ? `${first}${SEPARATOR}${second}` : first;
}

export function parsePairedItemId(itemId: string): { first: string; second?: string } {
  const [first = itemId, second] = itemId.split(SEPARATOR);
  return second ? { first, second } : { first };
}
