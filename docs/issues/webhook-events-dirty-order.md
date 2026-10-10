# Webhook 設定以 events.join(',') 判斷修改，勾選順序不同會誤判

## 現況

`apps/backstage/src/features/webhook/pages/WebhookDetail/components/WebhookSettingsSection.tsx` 第 80–84 行：

```ts
draft.events.join(',') !== webhook.events.join(',')
```

事件陣列的順序實際會變：

- `components/WebhookEventSelect.tsx` 第 49 行的 `valueOrder="options"` 只影響觸發鈕上的顯示；`packages/ui/src/components/Select/useSelectModel.ts` 第 92–98 行的 `onValueChange` 傳出的是勾選順序（新勾的接在最後）。
- api 照收到的順序存（`apps/api/src/modules/webhook/webhook.service.ts` 第 241 行），不排序。

所以取消勾選某個事件再勾回來，內容與伺服器相同，但順序變了，`dirty` 仍為 `true`。

## 影響

離開頁面時跳出「有未儲存的修改」（`useUnsavedChangesGuard`），session 結束時也會存一份沒有差異的草稿（`useFormDraft`）。

嚴重度低：只是誤報的提醒。

## 修正方式

比對時不看順序：例如兩邊各自 `toSorted()` 後再 `join`，或比較長度相同且 `new Set(webhook.events)` 包含每一個 `draft.events`。（儲存時的順序不影響投遞，不必改 api。）

## 驗證方式

- `WebhookSettingsSection` 測試補：開始編輯後取消一個事件再勾回來，`dirty` 為 false、換頁不跳出未儲存的提醒。

（2026-10-10 backstage 各功能的優化分析發現。）
