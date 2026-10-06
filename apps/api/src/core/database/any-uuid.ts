import { sql } from 'drizzle-orm';
import type { Column, SQL } from 'drizzle-orm';

/**
 * `column = ANY($1::uuid[])`：整批 id 以 **一個** 陣列參數傳遞（docs/architecture/backend/09-file.md §11）。
 *
 * `inArray` 每個 id 用一個綁定參數：postgres.js 超過 65,534 個參數就拋 `MAX_PARAMETERS_EXCEEDED`，
 * 逐一綁定也讓規劃時間隨 id 數變長。清單可能很大時（讀得到的資料夾、整棵資料夾樹的標籤）用這個。
 *
 * 陣列以 Postgres 的陣列字面量（`{"a","b"}`）當成一個文字參數送出、在 SQL 裡轉成 `uuid[]`：
 * 不依賴驅動程式推斷陣列參數的型別；每個元素都加引號並跳脫，不是 uuid 的值在轉型時就失敗。
 */
export function anyUuid(column: Column | SQL, ids: readonly string[]): SQL {
  return sql`${column} = ANY(${uuidArrayLiteral(ids)}::uuid[])`;
}

function uuidArrayLiteral(ids: readonly string[]): string {
  const elements = ids.map((id) => `"${id.replaceAll(/[\\"]/g, (char) => `\\${char}`)}"`);
  return `{${elements.join(',')}}`;
}
