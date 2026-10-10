# 「我的匯入匯出」不理會通知帶來的 `?transfer=<id>`

## 現況

- `apps/backstage/src/features/data-transfer/routeLinks.ts` 第 9–13 行：通知的 route id `dataTransfer.detail` 連到 `DataTransferListRoute`，把 `transferId` 放進 `?transfer=`。後端 `docs/architecture/backend/15-notification.md` 第 169 行：`dataTransfer.detail` → `/data-transfer?transfer=<id>`，用在 `dataTransfer.exportFinished`、`dataTransfer.importFinished`。
- `apps/backstage/src/features/data-transfer/routes/model.ts` 第 6–7 行：`transfer` 已經在 search schema 裡（註解「從通知點進來時帶的傳輸 id」）。
- `apps/backstage/src/features/data-transfer/pages/DataTransferList/page.tsx` 第 51–112 行：只讀 `search.offset`、`search.limit`，`search.transfer` 完全沒有用到；`TransferTable`（`packages/web-core/src/data-transfer/TransferTable.tsx` 第 25 行起的 props）也沒有標示某一列的參數。

## 影響

從「匯出完成」的通知點進來，看到的是一般的列表第一頁，不知道是哪一列；那筆傳輸不在第一頁（列表照建立時間排序，之後又做了幾十筆匯入匯出）時根本找不到，只能自己翻頁。route id 叫 `detail`、參數也帶了，實際上沒有「詳情」的效果。

嚴重度低：規格（`docs/architecture/frontend/21-data-transfer.md` §5）沒有定義帶了 `transfer` 之後的行為，資料與下載都正常，只是點通知後的體驗。

## 修正方式

1. `TransferTable` 加 `highlightId?: string`：那一列加上醒目的底色（走 Design Token）與 `data-highlighted`，第一次渲染時 `scrollIntoView`。
2. `DataTransferListPage` 把 `search.transfer` 傳進去。不在目前頁時：以已有的單筆查詢（`apps/backstage/src/apis/data-transfer/get-transfer/`）取那一筆，在列表上方顯示一張「通知的這筆傳輸」的卡片（含下載、查看結果），不必推算它在第幾頁。
3. 使用者翻頁或關掉卡片時以 `replace` 拿掉 `transfer`。
4. `docs/architecture/frontend/21-data-transfer.md` §5 補上帶 `transfer` 時的行為。

## 驗證方式

- 頁面測試（`DataTransferListPage.test.tsx`）：網址帶 `transfer=<第一頁的 id>` 時那一列有 `data-highlighted`；帶不在第一頁的 id 時顯示那一筆的卡片與它的動作。
- `TransferTable` 的元件測試（web-core）：`highlightId` 標示正確的一列。

（2026-10-10 backstage 各功能的優化分析發現。）
