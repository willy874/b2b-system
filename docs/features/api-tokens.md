# 服務帳號／API Token

- 優先度：P2
- 狀態：提案
- 依賴：—
- 相關：[`overview/03-roadmap.md`](../overview/03-roadmap.md)「Phase 1 之後」第 8 項、[`webhooks.md`](./webhooks.md)

> 使用方式見 [`README.md`](./README.md)。功能完成後刪除本檔，內容重寫成正式文件歸檔。

## 背景

API 目前只能用登入後的 JWT 呼叫。CI、美術工具的匯入腳本、遊戲建置流程要呼叫 API 時，
只能拿真人帳號的密碼，既不安全，稽核上也分不出是人還是程式。

## 範圍

| 做 | 不做（這一版） |
| --- | --- |
| 個人存取 token（代表自己，權限 ≤ 自己） | OAuth2 client credentials |
| 服務帳號（非人類使用者，指派角色） | token 的 IP 白名單 |
| token 建立時只顯示一次，資料庫只存雜湊 | |
| 到期時間、最後使用時間、撤銷 | |

## 初步構想

- 驗證：`Authorization: Bearer <prefix>_<random>`，guard 以前綴區分 JWT 與 API token
- 服務帳號是 `users` 的一種類型（不能登入、沒有密碼），沿用角色與權限快取
- 反提權：建立 token 時勾選的權限必須 ⊆ 建立者的權限
- 稽核：`actor` 記服務帳號或 token id，能追到是哪一把 token
- 速率限制：依 token 計算，不依 IP

## 開放問題

1. 個人 token 要限縮權限範圍（scope），還是一律等於本人權限？
2. 服務帳號屬於誰？離職時怎麼處理？

## 歸檔去向

- `docs/adr/NNNN-api-tokens.md`
- `docs/architecture/backend/04-auth.md` 新增章節、`rbac/02-permission-catalog.md`
