# 租戶用量總覽

- 優先度：P2
- 狀態：提案
- 依賴：—
- 相關：[`05-tenancy.md`](../architecture/05-tenancy.md) §5.3（feature 參數）、
  [`08-monitoring.md`](../architecture/08-monitoring.md) §2.3（指標的標籤不帶租戶）、[`06-external-api.md`](../architecture/06-external-api.md)（API 呼叫量）

> 使用方式見 [`README.md`](./README.md)。功能完成後刪除本檔，內容重寫成正式文件歸檔。

## 背景

平台管理者現在看不到「每個租戶用了多少」：

- Prometheus 指標刻意 **不帶租戶標籤**（基數會爆，[`08-monitoring.md`](../architecture/08-monitoring.md) §2.3），依租戶只能從 trace 的 `b2b.tenant` 個別追。
- 配額（`file.storageQuotaMb` 等，[`05-tenancy.md`](../architecture/05-tenancy.md) §5.3）在上傳當下加總判斷，但沒有地方看「離上限還有多少」。
- 要決定方案、計費、找出沉睡或濫用的租戶，都需要每個租戶的用量。

## 範圍

| 做 | 不做（這一版） |
| --- | --- |
| 每日彙總每個租戶的用量，存平台 DB | 即時（秒級）用量 |
| 項目：使用者數（啟用／全部）、服務帳號數、儲存量、本日 API 請求數（後台與對外 API 分開）、背景工作數、最後活動時間 | 計費、發票 |
| apps/platform 的租戶列表加用量欄位與排序；詳情頁顯示近 30 天趨勢與「配額使用率」 | 租戶管理者自己看的用量頁（見開放問題 3） |
| 接近配額（例 80%）時通知平台管理者 | |

## 使用者故事

**作為平台營運，我希望看到哪些租戶的儲存量快到上限，以便主動聯絡客戶升級。**

- **Given** 租戶 acme 的 `file.storageQuotaMb` 為 2048，已用 1800
- **When** 每日彙總執行
- **Then** 租戶列表的儲存欄顯示 88%（標成警示），平台管理者收到一則平台通知

## 初步構想

- 資料模型（平台 DB）：`tenant_usage_daily`：`tenant_id`、`date`、`metric`、`value`；PK `(tenant_id, date, metric)`。
- 彙總：平台背景工作 `tenant.usageRollup`（每日），對每個 `active` 租戶在租戶脈絡裡查計數（`users`、`files.size` 加總等）。
- 請求數：每個程序在記憶體依租戶累計，定期（例每分鐘）以 `INSERT … ON CONFLICT DO UPDATE` 加到平台 DB 的當日列；不走 Prometheus。
  多程序時天然可加總。
- 前端：apps/platform `features/tenant` 的列表與詳情。
- 權限：`tenant:read` 即可看。
- 通知：`platform-notification` 新增類型 `tenant.quotaNearLimit`。

## 開放問題

1. 請求數的累計會不會在程序崩潰時遺失一分鐘？可接受嗎？
2. 保留多久的日資料（平台 DB 會隨租戶數 × 天數成長）？
3. 要不要讓租戶管理者在 backstage 看到自己的用量與配額？（目前配額只有平台看得到）
4. 「最後活動時間」用最後一次登入還是最後一次寫入？

## 設計決策

（待開放問題有結論後填寫）

## 歸檔去向

- `docs/architecture/05-tenancy.md`（新增「用量」章節與設計決策）
