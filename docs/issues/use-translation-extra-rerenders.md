# `useTranslation` 在任何語系包載入完成時都讓所有元件重繪，連非目前語系的也算

## 現況

`packages/web-core/src/locales/useTranslation.ts` 的 `useTranslation()`（L12–37）訂閱兩個訊號：

```ts
i18n.on('languageChanged', force);
const unsubscribe = subscribeLocaleScopeLoaded(force);   // L18
```

- `subscribeLocaleScopeLoaded()` 的 listener 會收到 `(scope, language)`（`i18n.ts` L105），但 `force` 不看參數：任何一包載入完成，所有掛著的 `useTranslation()` 都會重繪。
- 每次重繪都換一個新的 `t`（L27–36 的 `useMemo` 依賴 `version`），依賴 `t` 的 memo 也跟著重算，例如表格的欄位定義。
- 兩個 app 與 packages 共有 269 個檔案呼叫 `useTranslation()`（不含測試）。

切換語系時最明顯：

- `changeLanguage()`（`i18n.ts` L136–140）先並行補載「每個已載入過的 scope」的新語系版本，最後才 `i18n.changeLanguage()`。
- 每一包下載完成都觸發一次全部重繪。此時 `i18n.language` 還是舊值，畫面上的字沒有變。
- 造訪過 N 個 feature 後切換語言，最多 N＋1 波整頁重繪，前 N 波都是白做的。
- 各包是分別下載完成的，所以 React 不一定能合併成一次。

這個訂閱是在 510652a4（2026-10-01）加上的。之後有些地方沒有跟著更新：

- 註解還寫舊的行為：
  - `i18n.ts` L113：「`useTranslation` 只在切換語系時重渲染」。
  - `packages/web-core/src/batch/activeQueue.ts` L55：「`useTranslation` 只在切換語系時重新渲染，補進語系包不會觸發」。
- 為了舊行為寫的手動重繪現在是多餘的：
  - `activeQueue.ts` 的 `useBatchOperationLocales()`（L57–70）載完後自己 `rerender()`。
  - 兩個 app 的 `features/notification/hooks/useNotificationLocale.ts`（L10–22，兩份內容相同）也一樣。

## 影響

- 切換語言時整頁重繪多次。列表頁、檔案管理頁在低階裝置上會短暫卡頓。只發生在切換語言時。
- 第一次進入某個 feature 時，路由的 loader 載完語系包，頂列、側欄等已經掛著的元件會多重繪一次。成本小。
- 註解與程式不符，讀的人會以為還需要手動重繪，繼續照抄 `rerender` 的寫法。

## 修正方式

1. `useTranslation()` 只在載入的是目前語系時重繪：

   ```ts
   const unsubscribe = subscribeLocaleScopeLoaded((_scope, language) => {
     if (language === i18n.language) force();
   });
   ```

   切換語系的最後一步 `i18n.changeLanguage()` 會發 `languageChanged`，仍然會重繪一次。
2. 刪掉 `useBatchOperationLocales()` 與兩個 `useNotificationLocale()` 裡的 `useReducer`／`rerender()`，只保留觸發載入的部分。
3. 更新 `i18n.ts` L113 與 `activeQueue.ts` L55 的註解。

## 驗證方式

- `packages/web-core/src/locales/__tests__/i18n.test.ts` 補一個 hook 測試：
  - 登記 3 個 scope 並載入，掛一個計算 render 次數的元件。
  - `changeLanguage()` 之後只多 render 1 次。
  - 載入一個「目前語系」的新 scope，仍然會重繪一次（偏好頁、晚到的 feature 需要這個行為）。
- 現有的語系與通知鈴鐺測試照過。
