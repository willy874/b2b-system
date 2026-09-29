# 後端文件

`apps/api` — NestJS 11 + Drizzle ORM + PostgreSQL 17。

結構刻意與前端同構：`modules/` 對應前端的 `features/`，`core/` 對應
前端的 `core/`。同一個功能在兩邊叫同一個名字，找東西不需要換腦袋。

## 章節

| #   | 檔案                                               | 內容                                         |
| --- | -------------------------------------------------- | -------------------------------------------- |
| 01  | [`01-architecture.md`](./01-architecture.md)       | 模組分層、相依方向、請求管線                 |
| 02  | [`02-database.md`](./02-database.md)               | Drizzle schema、完整表定義、migration 流程   |
| 03  | [`03-api-conventions.md`](./03-api-conventions.md) | 回應信封、分頁、驗證、錯誤碼                 |
| 04  | [`04-auth.md`](./04-auth.md)                       | 登入、JWT、refresh 輪替與重用偵測            |
| 05  | [`05-rbac.md`](./05-rbac.md)                       | Guard、Decorator、權限快取、反提權、路由稽核 |
| 06  | [`06-audit-log.md`](./06-audit-log.md)             | 稽核日誌設計與不可變性                       |
| 07  | [`07-testing.md`](./07-testing.md)                 | 單元 / 整合 / e2e 測試策略                   |
| 08  | [`08-realtime.md`](./08-realtime.md)               | Socket.io gateway、room 與受眾、推播時機     |
| 09  | [`09-file.md`](./09-file.md)                       | 物件儲存抽象層、`files` 轉介表、直傳上傳流程 |
| 10  | [`10-jobs.md`](./10-jobs.md)                       | 背景工作佇列（pg-boss）、排程、管理 API      |

## 四條必須記住的規則

1. **`core/` 永遠不認識任何 `modules/`。**
2. **Controller 不含業務邏輯**，只做 HTTP ↔ DTO 轉換與權限宣告。
3. **Repository 不含業務邏輯**，只有 Drizzle 查詢。
4. **每一個路由都必須宣告 `@Public()`、`@Authenticated()` 或
   `@RequirePermissions()` 其中之一** —— 沒宣告的路由會讓程序啟動失敗。
