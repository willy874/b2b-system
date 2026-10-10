# 稽核日誌在總數到達上限時，「最後一頁」與跳頁會送出超過上限的 offset 而 400

## 現況

- `apps/api/src/modules/audit-log/audit-log.constants.ts`：`AUDIT_LOG_MAX_OFFSET = 10_000`、`AUDIT_LOG_COUNT_CAP = AUDIT_LOG_MAX_OFFSET + 100`（10,100）；註解寫「能翻到的最後一頁（`AUDIT_LOG_MAX_OFFSET` ＋ 一頁）」。
- `apps/api/src/modules/audit-log/dto/list-audit-log.dto.ts` 第 24 行：`offset` 是 `.max(AUDIT_LOG_MAX_OFFSET)`，超過回 `400 VALIDATION_FAILED`（`docs/architecture/backend/06-audit-log.md` §7.2 第 301–302 行）。
- `apps/backstage/src/features/audit-log/pages/AuditLogList/page.tsx` 第 129–135 行：`pagination.total` 直接用回應的 `pagination.total`（最多 10,100），`pageSizeOptions` 是 25／50／100（預設 50，`routes/model.ts` 第 5、18 行）。
- `packages/ui/src/components/Pagination/Pagination.tsx` 第 81、89–92、139–151 行：`pageCount = ceil(total / limit)`，「最後一頁」按鈕與頁碼輸入框以 `(page − 1) × limit` 算 offset；沒有 `maxOffset` 之類的上限。`packages/web-core/src/components/RichTable/RichTable.tsx` 第 287–295 行原樣轉交。
- 混合分頁（`useAuditLogCursor.ts`）只在 **依序按「下一頁」** 時用游標；跳頁、最後一頁、從網址進來仍以 offset 取（§7.2 第 308 行，刻意的設計）。

總數到達 10,100 時：

| 每頁 | 頁數 | 最後一頁的 offset | 超過 10,000 的頁 |
| --- | --- | --- | --- |
| 25 | 404 | 10,075 | 402–404 頁 |
| 50（預設） | 202 | 10,050 | 202 頁 |
| 100 | 101 | 10,000 | 無 |

## 影響

90 天內稽核超過一萬筆的租戶（數百人規模就會到），管理者在預設的每頁 50 筆按「最後一頁」或在頁碼輸入最後一頁，列表變成錯誤畫面（`VALIDATION_FAILED`），而不是規格說的「再往後請縮小範圍或加篩選」。每頁 25 筆時最後三頁都會這樣。依序按「下一頁」翻到那裡時因為用游標反而正常，行為不一致。

另外，§7.2 第 302 行寫「畫面上的總數等於上限時代表『至少這麼多』」，但畫面上的摘要（`common.paginationSummary`）照常顯示「共 10,100 筆」，沒有任何「以上」的提示。

嚴重度中：與規格（總數上限「剛好涵蓋能翻到的最後一頁」）不一致，錯誤畫面可以重試或換頁恢復，資料本身正確。

## 修正方式

1. `Pagination`（`packages/ui`）加選用的 `maxOffset`：`pageCount = min(ceil(total / limit), floor(maxOffset / limit) + 1)`，「最後一頁」與頁碼輸入都以它夾住；`RichTablePagination` 轉交這個參數。設計系統不出現業務名詞，參數名保持通用。
2. 稽核日誌頁傳 `maxOffset: AUDIT_LOG_MAX_OFFSET`（前端常數，或由 api 在回應的 `pagination` 帶 `maxOffset`／`capped: true`，避免兩邊的數字各寫一份）。
3. `total >= AUDIT_LOG_COUNT_CAP` 時摘要改成「10,000 筆以上，請縮小範圍或加篩選」之類的文案（`auditLog.paginationCapped`，兩個語系檔）。
4. 若要從網址直接帶入超過上限的 `offset`（`routes/model.ts` 第 4 行沒有上限），在 search schema 夾到上限，或收到 400 時退回最後一個合法的頁。

## 驗證方式

- `packages/ui` 的 `Pagination` 單元測試：`total = 10100, limit = 50, maxOffset = 10000` 時頁數是 201、「最後一頁」送出 `offset = 10000`；頁碼輸入 999 夾到 201。
- 稽核頁的元件測試：回應的 `total` 是 10,100 時，按「最後一頁」送出的 `offset` 不超過 10,000，且顯示「以上」的提示。
- E2E 不必加（要造一萬筆稽核）。

（2026-10-10 backstage 各功能的優化分析發現。）
