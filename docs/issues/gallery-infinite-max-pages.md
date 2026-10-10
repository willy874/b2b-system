# 圖片庫的無限捲動沒有頁數上限

## 現況

（路徑相對 `apps/backstage/src/`，後端的相對 `apps/api/src/`。原本同一份文件的其他幾項已於 2026-10-10 修正：
審批流程列表的權限目錄與進行中的計數一次查好、部門規則的選項以 `useMemo` 計算、檔案預覽元件改為 lazy 載入、
圖片庫檢視器的按鍵 effect、公告受眾選擇器的請求。）

- `apis/gallery/get-gallery-items/query.ts`（`getGalleryItemsInfiniteQueryOptions`）沒有設 `maxPages`，往下捲多久，記憶體裡就留多少頁；
  重新驗證（推播、回到分頁）時 TanStack 依序重抓保留的每一頁，捲了 50 頁就是 50 個依序的請求。
  檔案管理的 `apis/file/get-file-list/query.ts` 設了 `maxPages: FILE_INFINITE_MAX_PAGES`（10 頁，`docs/architecture/frontend/12-file-manager.md` 的無限捲動一列）。
- `maxPages` 需要 `getPreviousPageParam` 才能往回捲；圖片庫的列表 API（`modules/gallery/gallery-item.service.ts` 的 `list()`）目前只回 `nextCursor`，
  游標（`modules/gallery/gallery.cursor.ts`）也沒有方向。
- 前端不是單純加選項：檔案管理以頁碼（`FileInfinitePageParam.index`）算出被丟掉的頁數，以 **等高的佔位** 保住捲動位置——格線的每列等高，佔位高度可以直接算。
  圖片庫是 `JustifiedGrid`（`packages/ui`，`docs/architecture/frontend/07-ui-system.md` §3.19），列高依每張圖的比例而定，
  丟掉的頁要先記下它排出來的高度，佔位才會等高；日期捲軸（`startAt`）的起點之前也要能以 `prevCursor` 往回取。

## 影響

長時間瀏覽大型圖片庫時，分頁資料持續累積（畫面是虛擬捲動，主要是記憶體），重新驗證的請求數隨捲過的頁數成長。嚴重度低。

## 修正方式

1. 後端：游標加方向（`before`，與 `modules/file/file.cursor.ts` 相同的寫法，`after` 不寫方向以相容既有游標），repository 往前取時反向排序再倒回；
   `list()` 回 `prevCursor`（帶游標往前取的頁不滿一頁才是最前面；`startAt` 的第一頁前面可能還有）。改了 DTO 要依 CLAUDE.md 重產 openapi 與 SDK。
2. 前端：頁參數帶頁碼、加 `getPreviousPageParam` 與 `maxPages`；`JustifiedGrid` 支援「前面有 N px 的佔位」，
   圖片庫在丟頁時記下那幾頁排版後的高度，捲回佔位區時以 `fetchPreviousPage` 抓回來。
3. 規格 `docs/architecture/frontend/24-gallery.md` §3、`backend/26-gallery.md` §6 同步補上頁數上限與 `prevCursor`。

## 驗證方式

- 後端：`gallery.cursor` 的單元測試補方向；gallery 的整合測試往後取兩頁再以 `prevCursor` 取回第一頁，內容一致。
- 前端：`apis/gallery/get-gallery-items/__tests__/` 驗證 `maxPages` 與 `getPreviousPageParam`；gallery E2E 往下捲超過上限再往回捲，圖片仍正確顯示、捲動位置不跳。

（2026-10-10 backstage 各功能的優化分析發現。）
