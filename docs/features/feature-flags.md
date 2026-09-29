# Feature Flag

- 優先度：P3
- 狀態：提案
- 依賴：[`system-settings.md`](./system-settings.md)
- 相關：—

> 使用方式見 [`README.md`](./README.md)。功能完成後刪除本檔，內容重寫成正式文件歸檔。

## 背景

編輯器功能會分批上線。沒有 flag 時，只能用 branch 擋住未完成的功能，合併週期會拉長。

## 範圍

| 做 | 不做（這一版） |
| --- | --- |
| flag 定義在程式碼，開關值存在設定表 | A/B 實驗與統計 |
| 依角色、使用者開放 | 百分比漸進釋出 |
| 前端 plugin 可依 flag 決定是否註冊（頁面、選單） | |

## 初步構想

- 建在 [`system-settings.md`](./system-settings.md) 上：flag 是一種特殊的設定
- 後端以 decorator 擋路由（flag 關閉時回 404，不是 403）
- 前端在 `/auth/profile` 一併取得目前使用者生效的 flag

## 開放問題

1. flag 與權限的界線：什麼時候該用權限、什麼時候用 flag？需要寫成規則
2. flag 移除的流程（避免永久殘留）

## 歸檔去向

- `docs/architecture/backend/NN-settings.md`（與系統設定同章）、`frontend/02-plugin-system.md`
