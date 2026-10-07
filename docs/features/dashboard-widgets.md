# 首頁儀表板（widget 登記）

- 優先度：P3
- 狀態：提案
- 依賴：—
- 相關：[`frontend/02-plugin-system.md`](../architecture/frontend/02-plugin-system.md) §6（註冊表）、[`frontend/18-command-palette.md`](../architecture/frontend/18-command-palette.md)（`navigation.ts`、`search.ts` 的登記方式）

> 使用方式見 [`README.md`](./README.md)。功能完成後刪除本檔，內容重寫成正式文件歸檔。

## 背景

backstage 與 apps/platform 都有 `features/home`，但首頁的內容由 home 自己決定，其他 feature 沒有地方放「我的待辦數」「本週新增」這類摘要。
側欄（`navigation.ts`）與命令面板（`search.ts`）已經是 feature 自行登記、依權限過濾的模式；首頁可以照做，
讓每個業務功能上線時順便提供一兩張卡片。

## 範圍

| 做 | 不做（這一版） |
| --- | --- |
| feature 登記 widget：id、標題、尺寸、需要的權限、元件（lazy） | 使用者自由拖拉版面、調整大小 |
| 首頁依權限與 feature 開關顯示 widget | 圖表元件庫、自訂報表 |
| 使用者可以隱藏某些 widget（偏好） | 跨租戶的平台儀表板（見 [`tenant-usage.md`](./tenant-usage.md)） |
| 第一批：待我審核數、未讀通知、最近檔案、背景工作失敗數 | |

## 使用者故事

**作為審核者，我希望一登入就看到有幾件待我審核，以便不必進審批頁才知道。**

- **Given** 我有 `approval:review`
- **When** 我打開首頁
- **Then** 看到「待審核：3」的卡片，點了進到審批列表並帶好篩選；沒有這個權限的人看不到這張卡片

## 初步構想

- 前端：`web-core` 加 widget 註冊表（plugin 同步階段登記，與選單相同）；元件 lazy 載入，資料由各 feature 自己的 `apis/` 取得。
- 後端：不需要通用模組；各 widget 用既有端點，或該 feature 新增輕量的計數端點（例 `GET /approvals/count?status=pending&mine=1`）。
- 權限：widget 宣告 `requires`（權限、feature），與頁面同一套判斷。
- 偏好：隱藏的 widget id 存使用者偏好（本機或伺服器，見開放問題 1）。

## 開放問題

1. 隱藏與排序的偏好存本機還是伺服器？若做了 [`saved-views.md`](./saved-views.md) 可以共用那張表。
2. 計數類 widget 要不要隨推播即時更新，還是進首頁時抓一次？
3. apps/platform 的首頁要不要同一套（平台的 widget：佈建失敗的租戶、失敗的平台工作）？

## 設計決策

（待開放問題有結論後填寫）

## 歸檔去向

- `docs/architecture/frontend/NN-dashboard.md` 或 `02-plugin-system.md` 的註冊表章節
