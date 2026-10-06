# 游標裡的日期或數值不合 Postgres 的格式時回 500，不是 400

## 現況

檔案列表的游標：

- `apps/api/src/modules/file/file.cursor.ts` 的 `decodeFileCursor()`（L31–47）只做這兩個檢查：

  ```ts
  if (field === 'size' ? typeof value !== 'number' : typeof value !== 'string') return undefined;
  if (field === 'createdAt' && Number.isNaN(Date.parse(value as string))) return undefined;
  ```

- 值直接進 SQL：`file.repository.ts` 的 `afterCursor()`（L570–575）。
  - `createdAt` 寫成 `` sql`${cursor.value}::timestamptz` ``；
  - `size` 直接與 bigint 欄位比較。

通知列表的游標相同：

- `apps/api/src/modules/notification/notification.cursor.ts` 的 `decodeNotificationCursor()`（L20–32）以 `Date.parse` 檢查。
- `notification.repository.ts`（L58–59）寫成 `${cursor.createdAt}::timestamptz`。

V8 的 `Date.parse` 比 Postgres 寬鬆：

- `Date.parse('2026-02-30')`、`Date.parse('2026')`、`Date.parse('0')` 都回數字。V8 會把 2 月 30 日進位成 3 月 2 日。
- Postgres 不接受同樣的值：`'2026-02-30'::timestamptz` 回 `date/time field value out of range`，`'2026'` 回 `invalid input syntax`。
- `size` 的 `1.5`，或 `1e400`（`JSON.parse` 之後是 `Infinity`），型別都是 number，但轉不成 bigint。

這些 Postgres 錯誤沒有被轉成業務錯誤。`HttpExceptionFilter` 記一筆 error 日誌，回 `500 INTERNAL_ERROR`。

重現：

1. 組游標：`cursor = base64url(JSON.stringify(['createdAt', 'desc', '2026-02-30T00:00:00.000000Z', '<任一 uuid>']))`。
2. `GET /api/files?sort=-createdAt&cursor=<cursor>` 回 500。預期是 `400 VALIDATION_FAILED`（`details.field: 'cursor'`）。

同樣會回 500 的端點：

- 對外 API 的 `GET /v1/files?cursor=`：走同一個 `FileService.list()`（`file/external/file.external.service.ts` L76–89）。
- `GET /notifications?cursor=` 與 `GET /notifications/all?cursor=`。

## 影響

- 只影響錯誤分類與日誌。查詢是參數化的，資料不會錯，也不會多讀到東西。
- 已登入的使用者可以用構造的游標，以每分鐘 600 次的速度產生 error 等級的日誌，干擾告警。每筆日誌都帶著 SQL，見 [`db-error-log-leaks-params.md`](./db-error-log-leaks-params.md)。
- 與既有的約定不符：
  - [`backend/09-file.md`](../architecture/backend/09-file.md) §6.1 的游標規則；
  - `notification.service.ts` 的 `parseCursor()`（L60–66）註解寫「游標格式不對回 `400 VALIDATION_FAILED`」。

## 修正方式

擇一，建議 1：

1. 游標的值用與 encode 時一致的嚴格格式檢查。
   - `createdAt`：
     - 先比對 `/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}(\d{3})?Z$/`。資料庫 `to_char(… 'US')` 輸出 6 位小數；`file.service.ts` 的退路 `toISOString()` 輸出 3 位，兩種都要接受。
     - 再確認 `new Date(value).toISOString()` 的日期部分與原字串相同，這樣才能排除 2 月 30 日。
   - `size`：`Number.isSafeInteger(value) && value >= 0`。
2. 在 `HttpExceptionFilter` 把 Postgres 的 `22007`（invalid_datetime_format）、`22008`（datetime_field_overflow）、`22P02`（invalid_text_representation）、`22003`（numeric_value_out_of_range）轉成 `400 VALIDATION_FAILED`。
   - 缺點是會把真正的程式錯誤也報成 400，查問題時比較難發現。

## 驗證方式

- `apps/api/src/modules/notification/__tests__/notification.cursor.spec.ts` 的「格式不對」表補三筆：
  - `['2026-02-30T00:00:00.000000Z', ID]`；
  - `['2026', ID]`；
  - `['0', ID]`。
- `apps/api/src/modules/file/__tests__/file.service.spec.ts`：L785–791 附近已經有 `cursor: 'garbage'` 的案例，在旁邊補三種游標，都預期 `VALIDATION_FAILED`：
  - `createdAt` 是 `2026-02-30…`；
  - `size` 是 `1.5`；
  - `size` 是 `1e400`。
- `apps/api/test/file-lifecycle.spec.ts`：在真的 Postgres 上，帶 2 月 30 日的游標打 `GET /files`，回 400。
