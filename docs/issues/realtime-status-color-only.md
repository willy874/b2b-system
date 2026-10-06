# 頂列的即時連線狀態只靠顏色區分

## 現況

`packages/web-core/src/layout/RealtimeStatusIndicator.tsx` 的 `RealtimeStatusIndicator()`（L21–39）：

- 三種狀態都用同一個 `wifi` 圖示（L34），只換顏色（`STATUS_COLORS`，L14–18）：

  ```ts
  [RealtimeStatus.CONNECTED]: 'text-[var(--color-success-text)]',
  [RealtimeStatus.DISCONNECTED]: 'text-[var(--color-danger-text)]',
  [RealtimeStatus.DISABLED]: 'text-[var(--color-fg-muted)]',
  ```

- 狀態的文字只在提示框（`Tooltip`）與 `sr-only` 裡。
- `<output>` 不在 Tab 順序內（L28 的註解），只用鍵盤的人叫不出提示框。
- 圖示集（`packages/ui/src/icons/`）沒有表示中斷的圖示（例：`wifi-off`）。
- 兩個 app 的頂列都有它：`apps/backstage/src/app/layouts/headerTools.ts` L27、`apps/platform/src/app/layouts/headerTools.ts` L18。

## 影響

- 紅綠色弱的人分不出「已連線」與「已中斷」；只用鍵盤的人看不到說明（WCAG 1.4.1）。
- 中斷時列表不會即時更新，使用者不知道要自己重新整理。
- 報讀器使用者不受影響：有 `sr-only` 的文字，`<output>` 也會播報狀態變化。

## 修正方式

1. 中斷與停用改用不同的圖示：新增 `wifi-off`，或在圖示上加狀態標記（斜線、驚嘆號）。
2. 讓說明不只靠滑鼠擇一（建議 a）：
   - a. 中斷時在頂列顯示簡短的文字（例：「即時更新已中斷」）。
   - b. 讓指示器可以聚焦，鍵盤也能打開提示框。

## 驗證方式

`packages/web-core/src/layout/__tests__/RealtimeStatusIndicator.test.tsx`：

- 三種狀態使用的圖示不同（以 icon 名稱或 testid 斷言）。
- 已中斷時，畫面上有可見的文字，或可以用鍵盤聚焦取得說明。
