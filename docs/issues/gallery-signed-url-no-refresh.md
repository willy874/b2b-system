# 圖片庫的簽章網址到期後不會重抓，長時間開著的頁面破圖

## 現況

`packages/web-core/src/image/SignedImage.tsx` 第 17–26 行：`onExpired` 讓圖片載入失敗時失效擁有這筆資料的查詢、重抓後自動重試；`isLongLived` 在 `expiresAt` 前 60 秒主動呼叫 `onExpired`。兩個都沒給時，失敗就直接顯示 `fallback`。

圖片庫的 `SignedImage` 全部沒有傳這兩個 props：

- `apps/backstage/src/features/gallery/pages/Gallery/components/GalleryGrid.tsx` 第 78–84 行（等高排列、方格）
- `apps/backstage/src/features/gallery/pages/Gallery/components/GalleryList.tsx` 第 102–108 行（列表）
- `apps/backstage/src/features/gallery/pages/Gallery/components/GalleryViewer.tsx` 第 513–519 行（檢視器下方的縮圖列）
- `apps/backstage/src/features/gallery/pages/Gallery/components/GalleryAlbumBar.tsx` 第 59–65 行（相簿封面）
- `apps/backstage/src/features/gallery/imageSource/GalleryImageSource.tsx` 第 123–129 行（選圖對話框的圖片庫來源）

檢視器的主圖也一樣：`GalleryViewer.tsx` 第 50–64 行 `usePreload` 與第 66–85 行 `levelsOf` 直接拿 `item.image.variants` 的 `src` 與詳情的 `original.url`，交給 `ImageViewer`，沒有任何到期後的重抓。整個 `features/gallery` 與 `apis/gallery` 都沒有 `onExpired`、`coalesce`、`expiresAt` 或 `refetchInterval`。

規格要求重抓：

- `docs/architecture/backend/25-image.md` §4：圖片庫的網址效期 1 小時，理由是「檢視器可能開很久，配合 §5 的重抓」；時間窗是效期的一半，實際剩餘效期介於 30 分鐘到 1 小時。
- 同文件 §5：「長時間開著而且會繼續載入新圖的頁面（圖片庫的無限捲動、檢視器的預先載入）傳 `isLongLived`」。
- `docs/architecture/frontend/24-gallery.md` §3 的「圖片」列：「網址到期前隨查詢重抓」。

對照已經做到的地方：`apps/backstage/src/features/user/pages/UserList/components/UserTable.tsx` 第 41–44 行以 `coalesce(() => invalidateResources(...))` 給頭像的 `onExpired`；檔案管理器 `apps/backstage/src/features/file/pages/FileManager/useFileListData.ts` 第 15–18、78–83 行在失效前 60 秒重抓。

## 影響

圖片庫開著超過 30 分鐘到 1 小時後：

- 往下捲動載入的下一頁沒問題（新的回應帶新網址），但已載入頁面裡還沒進入可視範圍、尚未下載的圖（虛擬捲動、`loading="lazy"`）捲到時 403，直接顯示主色色塊，不會恢復，只能重新整理。
- 檢視器裡按上一張／下一張、放大到 `large`／原檔時載入失敗；預先載入抓的也是過期網址。
- 選圖對話框開久了同樣。

嚴重度中：行為與規格（25-image §4、§5，24-gallery §3）不一致；不會寫錯資料，重新整理即可恢復。

## 修正方式

1. `features/gallery` 定義一個模組層級的 `onGalleryImageExpired = coalesce(() => invalidateResources([{ resource: Resource.GALLERY_ITEM, kind: 'update' }]))`（相簿封面另一個，失效 `GALLERY_ALBUM`）。
2. `GalleryGrid`、`GalleryList`、`GalleryViewer` 的縮圖列、`GalleryImageSource` 傳 `onExpired` 與 `isLongLived`；`GalleryAlbumBar` 傳 `onExpired`。
3. 檢視器的主圖：`ImageViewer`（`packages/ui/src/components/ImageViewer/`）目前沒有載入失敗的回呼，加一個 `onError`，由 `GalleryViewer` 呼叫同一個 `onGalleryImageExpired`（並讓詳情查詢失效以重簽 `original`）；`usePreload` 以 `item.image.expiresAt` 判斷，快過期時不預先載入、等重抓。
4. 確認 `GALLERY_ITEM` 的 collection 失效對 infinite query 的影響：會重抓已載入的每一頁，`coalesce` 讓同一時間大量失敗只失效一次。

## 驗證方式

- 元件測試（`GalleryPage.test.tsx`）：格子的 `<img>` 觸發 `error` 後，`get-gallery-items` 被重新請求一次；多張同時失敗只請求一次。
- 元件測試：以 fake timers 把時間推到 `expiresAt − 60 秒`，列表自動重抓。
- `GalleryViewer` 測試：主圖載入失敗時重抓詳情與列表。
- E2E 不必加（要等網址真的過期）。

（2026-10-10 backstage 各功能的優化分析發現。）
