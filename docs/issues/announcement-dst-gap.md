# 夏令時間開始當天，落在不存在時段的發送時間會提早一小時

## 現況

當地時間換算成時刻有兩份實作，算法相同（先猜、再用猜的那一刻的位移校正一次）：

- 後端：`apps/api/src/modules/announcement/announcement.recurrence.ts` 的 `zonedInstant()`（L60–65），供週期公告的 `nextOccurrence()` 使用。
- 前端：`packages/web-shared/src/date/index.ts` 的 `zonedDateTime()`（L167–181），供 `apps/backstage/src/features/announcement/components/TriggerField.tsx`（L150）把「指定時間」換成 ISO。

夏令時間開始當天，時鐘從 02:00 跳到 03:00，02:00–02:59 這段當地時間不存在。兩份實作都會用跳之前的位移換算，結果落在跳之前的一小時。

重現（後端）：

```ts
nextOccurrence(
  { kind: 'recurring', frequency: 'daily', interval: 1, time: '02:30', startsOn: '2026-03-07', … },
  new Date('2026-03-07T12:00:00Z'),
  'America/New_York',
);
// 實際：2026-03-08T06:30:00Z（當地 01:30 EST）
// 預期：2026-03-08T07:30:00Z（當地 03:30 EDT）
```

[`backend/19-announcement.md`](../architecture/backend/19-announcement.md) §5.1 只寫「夏令時間依那一天的位移」，沒有規定不存在的時段怎麼處理。
一般慣例（Temporal 的 `disambiguation: 'compatible'`、cron、Google Calendar）是往後順延到跳過之後的同一個時間差。

`announcement.recurrence.spec.ts` 只斷言「當天仍發一次」，沒有斷言是幾點，所以現在的測試不會擋下這個行為。

## 影響

- 只影響有夏令時間的租戶時區，每年一天。設在 02:00–02:59 的公告會在 01:xx 發出，比設定的時間早一小時。
- 「提早」比「延後」更容易出錯：例如「維護開始」類的公告，會在維護還沒開始時就送出。
- 前端把「指定時間」換成時刻、後端計算週期，用的是同一套算法（週期的預覽本來就呼叫後端）。只修一邊，「指定時間」和「週期」對同一個當地時間會算出不同的時刻。

## 修正方式

1. 在 `zonedInstant()` 與 `zonedDateTime()` 校正之後再驗證一次：把結果換回當地時間，跟輸入的 `HH:mm` 比對。不相等，就表示落在不存在的時段，改用跳之後的位移（`offsetOf(結果 + 1h)`），讓 02:30 變成 03:30。
2. 重複的時段（夏令時間結束當天的 01:30）維持現在的行為：取較早的那一次（EDT）。`announcement.recurrence.spec.ts` 已經有這個測試。
3. 在 19-announcement.md §5.1 的 `time` 欄補一句：不存在的時段順延，重複的時段取較早的一次。前端的對應說明在 [`frontend/16-announcement.md`](../architecture/frontend/16-announcement.md)。

## 驗證方式

- `announcement.recurrence.spec.ts`：把夏令時間開始當天的測試改成斷言 `07:30Z`。
- `packages/web-shared/src/date/__tests__/date.test.ts`：補一個同樣情境的 `zonedDateTime` 測試。
