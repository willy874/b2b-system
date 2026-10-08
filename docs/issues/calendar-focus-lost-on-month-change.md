# 月曆：鍵盤換月後焦點掉到 body

## 現況

`packages/ui/src/components/DatePicker/Calendar.tsx` 約 95–103 行，讓焦點跟著 roving tabindex 走的 effect：

```ts
useEffect(() => {
  const container = containerRef.current;
  if (!container?.contains(document.activeElement)) return;
  …target?.focus();
}, [focused]);
```

用 PageUp／PageDown，或方向鍵、Home／End 跨到別的月份時，`moveFocus` 同時 `setMonth`，
原本有焦點的那一天的按鈕在重新渲染時被卸載，`document.activeElement` 變成 `<body>`；
effect 執行時 `contains` 已是 false 就直接 return，新月份的那一天不會被聚焦。

重現：`<Calendar selected={['2026-09-15']} …/>`，聚焦 09-15 後按 PageDown。
預期焦點在 10-15、可以繼續用鍵盤操作；實際 `document.activeElement` 是 `<body>`，再按方向鍵沒有反應。

## 影響

只用鍵盤的使用者換月後要重新 Tab 回月曆（無障礙；[`frontend/07-ui-system.md`](../architecture/frontend/07-ui-system.md) 的鍵盤操作要求）。
不影響滑鼠操作與選取結果。嚴重度：低。

## 修正方式

不要用「焦點目前在容器內」判斷要不要搬焦點，改成「這次的 focused 變動來自鍵盤」：
例如 `onKeyDown` 設一個 ref（`focusFromKeyboard.current = true`），effect 看到它才 focus 並重設；
或在 `moveFocus` 換月時以 `flushSync` 先渲染新月份再 focus。

## 驗證方式

`packages/ui/src/components/DatePicker/Calendar.test.tsx` 加案例：聚焦 09-15 → PageDown → `document.activeElement` 是 10-15 的按鈕，
再按 ArrowRight 到 10-16（不要在每次按鍵前重新聚焦，目前的測試就是這樣才沒發現）；方向鍵跨月（09-30 → ArrowRight）同樣斷言。

（2026-10-08 補單元測試時由 `Calendar.test.tsx` 的撰寫發現。）
