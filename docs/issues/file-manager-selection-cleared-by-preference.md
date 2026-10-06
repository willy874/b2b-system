# 檔案管理器：切換排列方式、或其他分頁改了偏好，選取就被清空

## 現況

偏好的每一次更新都會產生新的 `sort` 物件：

- `apps/backstage/src/features/file/preference.ts` 的 `useFileViewPreferenceStore.update()`（L78–83）一律經過 `parseFileViewPreference()`（L46–69）。
- `parseFileViewPreference()` 每次都建一個新的排序物件（L63）：

  ```ts
  ? { sort: sort.sort as FileSortField, order: sort.order }
  ```

- store 以 `Object.is` 比對欄位（`packages/web-shared/src/store/createStore.ts` 的 `setState`）。所以只改 `viewMode`，`sort` 也算變了。
- 其他分頁的變更也一樣：`syncFileViewPreference()`（L90–97）收到值，同樣經過 `parseFileViewPreference()`。

新的 `sort` 一路傳到清空選取的 effect：

1. `FileManagerPage`（`features/file/pages/FileManager/page.tsx` L39）沒有用 selector：`useFileViewPreferenceStore()`。
2. `useFileManagerItems.ts` 的 `filters`（L39–42）依賴 `sort`，所以換成新物件。
3. `page.tsx` L86 的 effect 依賴 `filters`，於是清空選取：

   ```ts
   // 換資料夾、換條件、換頁、換閱覽模式：原本的選取不在新的結果裡
   useEffect(clear, [clear, filters, search.offset, preference.pagingMode]);
   ```

重現：

1. 在卡片檢視選取幾個檔案。
2. 工具列切換成列表檢視（`page.tsx` L111 `preference.update({ viewMode })`）。
3. 選取全部消失。

另一個分頁切換排列方式、或改了每頁筆數，這個分頁的選取也會被清空。

以 vitest 在 store 層確認過：`update({ viewMode: 'list' })` 前後 `sort` 的內容相同（`toEqual` 通過），但參考不同（`toBe` 失敗）。

[`frontend/12-file-manager.md`](../architecture/frontend/12-file-manager.md) §4 規定選取只在「換資料夾、換條件、換頁、換閱覽模式」時清空。
「排列方式」（卡片／列表）只換顯示方式，項目沒有變，不在清空的條件裡。

## 影響

- 所有使用檔案管理器的人。常見的操作是先選好幾個檔案，再切成列表看詳細資訊，這時選取就不見了，要重選。
- 開著兩個分頁時，在一個分頁調整偏好，會無聲地清掉另一個分頁的選取（包括框選到一半的結果）。
- 不會送出錯誤的批次操作（選取被清空，而不是選錯），屬於體驗與行為不符規格。

## 修正方式

1. `sort` 值沒變時沿用原本的物件（建議）：
   - `update()` 在 `patch` 沒有 `sort` 時保留 `current.sort`。
   - 或在 `parseFileViewPreference()` 之後比對：`sort.sort`、`sort.order` 都相同，就用舊的物件。
   - `syncFileViewPreference()` 收到其他分頁的值時，也照同樣規則保留參考。
2. 防禦：`useFileManagerItems()` 的 `filters` 改依賴原始值 `sort.sort`、`sort.order`，不依賴物件參考。
3. 選做：`FileManagerPage` 改用逐欄的 selector 讀偏好，偏好的其他欄位變動時頁面不重繪。

## 驗證方式

- `apps/backstage/src/features/file/__tests__/preference.test.ts`：`update({ viewMode: 'list' })` 之後 `getState().sort` 與更新前是同一個參考。
- 頁面或 hook 測試（例：`FileManagerPage` 的整合測試，或 `useFileManagerItems` ＋ `useFileSelection` 的 hook 測試）：
  - 選取兩個項目 → 切換排列方式 → 選取仍在。
  - 換資料夾、換關鍵字、換閱覽模式 → 選取清空（現有行為不變）。
