# 檔案管理與圖片庫的上傳、下載、檢視器按鍵各寫一套

## 現況

圖片庫（`features/gallery`）是照著檔案管理（`features/file`）做的，幾段通用的機制兩邊各有一份（路徑相對 `apps/backstage/src/features/`）：

**1. 批次上傳的 `runUpload` 骨架**

- `file/batch.ts:66-102` 與 `gallery/batch.ts:61-85`：從暫存區取檔 → 取不到就丟 `*_UPLOAD_INCOMPLETE`（`reason: 'source-unavailable'`）→ 上傳 →
  `catch` 裡判斷 `RATE_LIMITED` 決定 `willRetry` → `finally` 失效 `Resource.FILE_STORAGE_USAGE` 並在不重試時刪掉暫存檔。
  兩份只差「上傳前的準備」（file 產生縮圖、gallery 量尺寸）、呼叫的上傳函式與成功後失效的資源。

**2. 佇列項目 id 編碼第二個值**

- `file/batch.ts:40-49`（`uploadItemId`／`parseUploadItemId`，`<key>@<folderId>`）與 `gallery/batch.ts:36-45`（`pairedItemId`／`parsePairedItemId`，`<first>@<second>`）：同一個演算法，名稱不同。

**3. 多檔下載**

- `file/pages/FileManager/useFileActions.ts:80-92`：每 250 ms（`:12` 的 `DOWNLOAD_INTERVAL_MS`）以 `setTimeout` 觸發一個 `<a download>`，**沒有上限**，
  anchor 也沒有掛進 DOM 就直接 `click()`（與下面 web-core 的作法不同）。
- `gallery/pages/Gallery/useGalleryActions.ts:13-21`（`triggerDownload`）與 `:44-58`：逐張 `await` 取詳情後觸發，**最多 50 張**（`gallery/constants.ts:32` 的 `GALLERY_DOWNLOAD_MAX`），超過時 toast 說明。
- `packages/web-core/src/data-transfer/download.ts:5-15` 已經有 `downloadFromUrl(url, fileName)`（掛進 DOM、點擊、移除），註解寫著「檔案管理的下載都用它」，但檔案管理實際上沒有用。

**4. 檢視器的按鍵處理**

- `file/pages/FileManager/components/FileLightbox.tsx:80-99` 與 `gallery/pages/Gallery/components/GalleryViewer.tsx:176-228`：
  同樣以 capture 階段的 `window` `keydown` 繞過 Base UI Dialog 的焦點管理、同樣的「輸入框與自帶方向鍵的控制項不攔截」選擇器
  （`'input, textarea, select, [contenteditable], [role="listbox"], [role="combobox"]'`，gallery 多了 `[role="menu"]` 與修飾鍵判斷）。
  `packages/web-core/src/hotkey/registry.ts:35-39` 另有一份相近但不同的 `isEditableTarget`（未匯出）。
  兩個檢視器的快捷鍵寫在元件裡是規格的決定（`docs/architecture/frontend/24-gallery.md` D22），重複的是「要不要攔這個按鍵」的判斷，不是快捷鍵本身。

## 影響

- 上傳的「限流時保留暫存檔」「登記即佔用容量所以一律重抓用量」這類規則改一邊時容易漏另一邊；第三個要上傳的 feature 會再複製一份。
- 下載行為兩邊不同：檔案管理選了一整頁（數十個）會連續觸發數十個下載且沒有提示，圖片庫則限制 50 張並說明。
- 按鍵過濾的選擇器有三份且內容不同（gallery 多了 `menu` 與修飾鍵、hotkey 少了 `listbox`／`combobox`），之後在檢視器裡加控制項時，要記得三份各自補。

嚴重度低：開發體驗與一致性；目前沒有造成錯誤資料。

## 修正方式

上傳的共用程式已經在 backstage 的 `core/upload/`（暫存區 `createUploadSources`、`collectEntries`），只有 backstage 會上傳，所以 1、2 放那裡；下載與按鍵判斷兩個 app 都可能用，放 packages。分四步：

1. **項目 id**：`core/upload/` 加 `pairItemId(first, second?)`／`parsePairedItemId(id)`，file 與 gallery 都改用它（file 的 `uploadItemId` 可以留成一行的包裝或直接換掉）。
2. **`runUpload` 骨架**：`core/upload/` 加 `createUploadRunner({ sources, incompleteCode, prepare, upload, onUploaded })`，
   回傳給 `registerBatchOperation` 用的 `run(itemId, ctx)`；取檔、`*_UPLOAD_INCOMPLETE`、`RATE_LIMITED` 的保留、`finally` 的用量失效與刪檔都在裡面。
   `core/` 不能 import `apis/`，上傳函式（`uploadFile`、`uploadGalleryItem`）由 feature 以參數傳入。
3. **下載**：檔案管理改用 `downloadFromUrl`（`@b2b-system/web-core/data-transfer`），並把「依序觸發、間隔、上限與超過時的提示」收成一個函式
   （例：`web-core/data-transfer` 的 `downloadSequentially(items, { intervalMs, max, onLimited })`），兩邊共用同一個上限；
   `docs/architecture/frontend/12-file-manager.md` §「選取列」的下載說明補上限。
4. **按鍵過濾**：`packages/web-core/src/hotkey/` 匯出 `isTypingTarget(event)`（合併三份選擇器：輸入框、`contenteditable`、`listbox`／`combobox`／`menu`、修飾鍵），
   `FileLightbox`、`GalleryViewer` 與 hotkey 註冊表都用它；兩個檢視器各自的按鍵對應維持在元件裡（D22）。

## 驗證方式

- `core/upload/__tests__/` 補 runner 的測試（可把 `features/file/__tests__/batch.test.ts` 的上傳案例搬過去：取不到檔、限流保留、成功與失敗都重抓用量）；
  file 與 gallery 的批次測試改為只驗證各自的 `prepare`／`upload`／失效資源。
- 下載：單元測試驗證超過上限只觸發前 N 個並呼叫 `onLimited`、anchor 有掛進 DOM 後移除。
- 按鍵：`isTypingTarget` 的表格測試；`FileLightbox.test.tsx` 的既有按鍵案例通過；GalleryViewer 目前沒有元件測試，補「輸入框裡按方向鍵不換張」與「← → 換張」兩案。
- 手動：檔案管理選 60 個檔案下載、圖片庫選 60 張下載，行為與提示一致。

（2026-10-10 backstage 各功能的優化分析發現。）
