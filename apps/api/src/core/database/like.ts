/**
 * 跳脫 `LIKE`／`ILIKE` 的萬用字元（`%`、`_`）與跳脫字元本身（`\`，Postgres 預設的 ESCAPE）。
 * 使用者輸入的關鍵字一律先經過這裡：否則搜尋 `_` 會匹配所有列。
 */
export function escapeLike(value: string): string {
  return value.replaceAll(/[\\%_]/g, (char) => `\\${char}`);
}

/** 「包含」比對的 pattern：`%<跳脫後的關鍵字>%`。 */
export function containsPattern(keyword: string): string {
  return `%${escapeLike(keyword)}%`;
}

/** 「開頭是」比對的 pattern：`<跳脫後的前綴>%`。 */
export function prefixPattern(prefix: string): string {
  return `${escapeLike(prefix)}%`;
}
