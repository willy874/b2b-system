# 前端文件

`apps/backstage` — React 19 + Vite + TanStack + Base UI。

架構是 plugin-based AppContext ＋ feature-first 分層。相對於同類後台常見的
MUI 作法，最大的差異是 **UI 函式庫改用 Base UI**，因此設計系統 `packages/ui`（`@b2b-system/ui`）這層
從「薄包裝」變成「真正的設計系統實作層」。

兩個前端（backstage、apps/platform）共用的機制層在 `packages/web-core`（`@b2b-system/web-core`）；文件裡的 `web-core/<module>` 指 `packages/web-core/src/<module>`，
`core/`、`app/`、`plugins/` 等指 app 自己的 `src/` 底下（[`01-architecture.md`](./01-architecture.md) §1）。
整體怎麼切、程式該放哪見 [`17-shared-packages.md`](./17-shared-packages.md)。

## 章節

| #   | 檔案                                                   | 內容                                        |
| --- | ------------------------------------------------------ | ------------------------------------------- |
| 01  | [`01-architecture.md`](./01-architecture.md)           | 七層分層、相依規則、一個請求的完整路徑      |
| 02  | [`02-plugin-system.md`](./02-plugin-system.md)         | AppContext、plugin 生命週期、註冊時序       |
| 03  | [`03-feature-anatomy.md`](./03-feature-anatomy.md)     | feature 資料夾規格 ＋ **新增 feature SOP**  |
| 04  | [`04-routing.md`](./04-routing.md)                     | TanStack Router、route 樹、權限守衛         |
| 05  | [`05-data-layer.md`](./05-data-layer.md)               | `apis/` 結構、query key、快取與失效策略     |
| 06  | [`06-permission.md`](./06-permission.md)               | 權限註冊表、hooks、UI gating 三層           |
| 07  | [`07-ui-system.md`](./07-ui-system.md)                 | Base UI 封裝、Design Token、元件契約        |
| 08  | [`08-i18n.md`](./08-i18n.md)                           | 語系分包、scope loader、命名                |
| 09  | [`09-state-and-storage.md`](./09-state-and-storage.md) | store 分類、持久化、跨分頁同步              |
| 10  | [`10-testing.md`](./10-testing.md)                     | Vitest / Testing Library / MSW / Playwright |
| 11  | [`11-realtime.md`](./11-realtime.md)                   | Socket.io、leader 分頁持有連線、推播 → 失效 |
| 12  | [`12-file-manager.md`](./12-file-manager.md)           | 檔案管理器：排版、選取、上傳佇列、預覽擴充點 |
| 13  | [`13-trash.md`](./13-trash.md)                         | 回收桶：類型註冊表、權限、使用者的還原與「復原」 |
| 14  | [`14-revisions.md`](./14-revisions.md)                 | 版本紀錄：版本列表、`JsonDiff` 比較、還原到某一版 |
| 15  | [`15-notification.md`](./15-notification.md)           | 站內通知：頂列鈴鐺、列表頁、通知總覽、route id 註冊表、事件管理頁 |
| 16  | [`16-announcement.md`](./16-announcement.md)           | 公告：列表、建立、詳情與發送紀錄、收件人看全文 |
| 17  | [`17-shared-packages.md`](./17-shared-packages.md)     | 兩個前端共用的 packages：分層、程式放哪、app 怎麼接上 web-core |

## 三條必須記住的規則

1. **`core/` 與 `@b2b-system/web-core` 永遠不認識任何 `features/`。** 反過來可以；web-core 另外不認識任何 app。
2. **Feature 之間不直接互相 import。** 需要連結時用 route id（`<RouteLink to="user.detail">`，
   [`03-feature-anatomy.md`](./03-feature-anatomy.md) §4.1），其他需求走 `apis/` 或事件匯流排。
3. **只有 `apis/` 會發 HTTP。** 頁面與元件拿到的是 query options，不是 `fetch`。
