# 個人資料的「儲存」沒有修改也能送出

## 現況

`apps/backstage/src/features/account/pages/Profile/page.tsx`：

- 第 69–70 行已經算出 `profileDirty`（草稿與伺服器上的名稱不同），只拿去給第 72 行的 `useUnsavedChangesGuard`。
- 第 135–143 行的儲存鈕只在 `!displayName.trim()` 時停用；第 106–111 行的 `onSubmit` 也沒有檢查是否修改。

沒有改名稱就按「儲存」（或在欄位按 Enter），照樣送出 `PATCH`、寫一筆稽核，並顯示「已儲存」的 toast。

## 影響

使用者以為有存到什麼；多一次無意義的寫入與稽核紀錄。

嚴重度低：結果正確，只是體驗與多餘的請求。

## 修正方式

儲存鈕改成 `disabled={!profileDirty || !displayName.trim()}`，`onSubmit` 開頭同樣 `if (!profileDirty) return;`（Enter 送出也擋住）。比對時可用 `trim()` 後的值，避免只多了空白也算修改。

## 驗證方式

- `features/account` 的頁面測試補：載入後儲存鈕停用；改名後啟用；改回原值又停用；未修改時按 Enter 不送出請求。

（2026-10-10 backstage 各功能的優化分析發現。）
