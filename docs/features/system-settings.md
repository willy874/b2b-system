# 系統設定（執行期可調）

- 優先度：P1
- 狀態：提案
- 依賴：—
- 相關：[`feature-flags.md`](./feature-flags.md)

> 使用方式見 [`README.md`](./README.md)。功能完成後刪除本檔，內容重寫成正式文件歸檔。

## 背景

`modules/system` 目前只有 `GET /system/info`。會隨營運調整的值都寫死在程式常數或 env 裡，
改一次就要重新部署。例如：密碼政策、登入失敗鎖定次數與時間、上傳大小上限、是否開放註冊。

`system:update` 權限已經在權限目錄，但沒有對應的功能。

## 範圍

| 做 | 不做（這一版） |
| --- | --- |
| key-value 設定表，每個 key 有 Zod schema 與預設值 | 依工作區覆寫的設定（等 [`workspace.md`](./workspace.md)） |
| 設定頁：依分類列出、編輯、還原預設 | 設定的版本歷史（稽核已有前後差異） |
| 修改寫稽核（前後差異），並經 realtime 通知 | |
| 前端可讀的公開設定（例如「是否開放註冊」） | |

## 初步構想

- 設定的定義在程式碼裡（key、schema、預設值、是否公開），資料庫只存覆寫值
- 各模組註冊自己的設定，`core/settings` 不 import `modules/`
- 讀取走快取，修改後失效（與權限快取同一套規則：交易後失效）
- env 仍保留「部署相關」的值（連線字串、密鑰），不搬進設定表

## 開放問題

1. 哪些既有常數要搬進來？需要逐一列出並確認不會讓安全性變弱（例如鎖定次數設成 0）
2. 設定值要不要在 schema 上限制範圍，避免管理員設出危險值？

## 歸檔去向

- `docs/architecture/backend/NN-settings.md`、前端設定頁併入對應的 frontend 章節
- 權限目錄確認 `system:read` / `system:update` 的說明
