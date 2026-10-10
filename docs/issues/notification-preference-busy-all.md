# 通知偏好儲存中停用所有開關

## 現況

`apps/backstage/src/features/notification/components/NotificationPreferenceSection.tsx` 第 65–68 行：

```tsx
disabled={entry.lock !== null || update.isPending}
```

切換任一個開關、請求還沒回來之前，頁面上所有事件的所有管道開關一起變成停用。每次切換只送一筆（第 29–30 行，`changes` 只有一個），彼此獨立，沒有必要全部鎖住。

另外：`GET /me/notification-preferences` 的每一項已經帶 `category`（openapi 的 `NotificationPreference`），事件管理頁依它分組（`docs/architecture/frontend/15-notification.md` 第 236 行），偏好頁仍是一長串（§10 的規格也只寫「一列一個事件」）；分組屬於新增的呈現，不在本問題範圍。

## 影響

連續切換幾個開關時，每次都要等前一個請求完成，整頁開關閃成停用再恢復。

嚴重度低：體驗問題。

## 修正方式

只停用正在送出的那一個：以 `update.isPending && update.variables` 比對 `type`＋`channel`（或用 `useMutationState` 收集進行中的變更），其他開關照常可切換。必要時同一個開關連點以最後一次為準。

## 驗證方式

- `NotificationPreferenceSection` 測試補：請求進行中時，被切換的開關停用、其他開關仍可用。

（2026-10-10 backstage 各功能的優化分析發現。）
