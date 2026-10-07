# 業務編號產生器

- 優先度：P3
- 狀態：提案
- 依賴：—
- 相關：[`backend/12-settings.md`](../architecture/backend/12-settings.md)（格式可能放系統設定）、[`custom-fields.md`](./custom-fields.md)

> 使用方式見 [`README.md`](./README.md)。功能完成後刪除本檔，內容重寫成正式文件歸檔。

## 背景

業務實體幾乎都要一個人看得懂、可以在電話裡唸的編號：`PO-2026-0001`、`INV-202610-0042`、`CASE-12345`。
uuid 不適合給人看；每個業務模組自己用 `max(no) + 1` 會在併發時重號，用 Postgres sequence 又不能依年度重置、不能有前綴格式。
骨架還沒有業務實體，但這是每一個業務功能都會遇到、而且容易寫錯的一層。

## 範圍

| 做 | 不做（這一版） |
| --- | --- |
| 擁有者模組登記一種編號（`key`、預設格式、重置週期） | 保證連號不跳號（交易回滾會留下空號，見開放問題 1） |
| 格式樣板：前綴、日期片段（`{YYYY}`、`{MM}`）、補零位數 | 依其他欄位分組（每個分店各自一組） |
| 重置週期：不重置、每年、每月（以租戶時區 `general.defaultTimezone` 判斷） | |
| 在業務交易內取號，併發不重號 | |
| 租戶管理者可以改前綴與格式 | |

## 使用者故事

**作為業務模組的開發者，我希望一行取得下一個訂單編號，以便不用處理併發與年度重置。**

- **Given** 訂單模組在 `onModuleInit` 登記 `order`，格式 `SO-{YYYY}-{seq:5}`、每年重置
- **When** 兩個請求同時建立訂單
- **Then** 各自在交易內拿到 `SO-2026-00041`、`SO-2026-00042`，不重號；跨年後從 `00001` 開始

## 初步構想

- 資料模型（租戶 DB）：`sequence_counters`：`key`、`period`（`2026`、`2026-10`、`all`）、`value`；PK `(key, period)`。
- 後端：`core/sequence`（或 `modules/sequence`）：`SequenceService.register(def)`、`next(key, tx)`：
  `INSERT … ON CONFLICT (key, period) DO UPDATE SET value = value + 1 RETURNING value`（列鎖讓併發排隊，鎖到交易結束）。
- 格式：樣板存系統設定（每種編號一個 key）或新表，見開放問題 2。
- 權限：改格式用 `system:update`。

## 開放問題

1. 要不要保證不跳號？鎖到交易結束已經會讓同種編號的寫入序列化；不跳號還要處理回滾，通常不值得（發票等法規要求另議）。
2. 格式放系統設定（只存純量，已有規則）還是獨立的表？
3. 改格式之後，當期的流水號延續還是重來？

## 設計決策

（待開放問題有結論後填寫）

## 歸檔去向

- `docs/architecture/backend/NN-sequence.md`
