# 資料夾授權的到期日與公告的「今天」用瀏覽器時區，不是偏好時區

## 現況

規格要求日期的顯示與日界線都用使用者偏好的時區：`@b2b-system/web-shared/date` 的 `formatDate()`、`zonedDayBoundary()`
（[`frontend/08-i18n.md`](../architecture/frontend/08-i18n.md) §5）。下面兩處改用 dayjs，也就是瀏覽器的本地時區：

1. 資料夾授權的到期：`apps/backstage/src/features/file/pages/FileManager/components/FileShareDialog.tsx`
   - `endOfDay()`（L47–50）把選的日期換成「瀏覽器時區的 23:59:59」，L261 送出：

     ```ts
     return dayjs(date).endOf('day').toISOString();
     ```

   - 可選的最早日期（L331）：`min={dayjs().format('YYYY-MM-DD')}`。
   - 顯示到期日（L369）：`dayjs(grant.expiresAt).format('YYYY-MM-DD')`。

2. 公告的「今天」：`apps/backstage/src/features/announcement/components/TriggerField.tsx` L179 `const today = formatDate(dayjs())`。
   這裡的 `formatDate` 來自 `@b2b-system/ui/DatePicker`，用的是瀏覽器時區。
   - 「指定時間」的最早日期（L199）用它；但輸入的日期與時間是以偏好時區換算（`fromTriggerDraft()` 裡的 `zonedDateTime()`）。
   - 「週期」的開始日預設值（L188）與最早日期（L406）也用它；但週期是依租戶時區計算。

## 影響

- 只影響瀏覽器時區和偏好時區不同的人，例如出差、用遠端桌面、或電腦時區設成 UTC。
- 授權會比預期早或晚幾小時到期。畫面上的到期日，和稽核等其他畫面的日期可能差一天。
- 公告的日期選擇器可能擋掉偏好時區的「今天」，或允許選到偏好時區已經過去的日期。

## 修正方式

1. `FileShareDialog`：
   - 到期改用 `zonedDayBoundary(expiresOn, 'end')`。
   - 顯示改用 `formatDate(grant.expiresAt)`（`@b2b-system/web-shared/date`）。
   - 最早日期用偏好時區的今天：`toZonedParts(new Date().toISOString())?.day`，或在 web-shared 加一個 `todayInZone()`。
2. `TriggerField`：
   - 「指定時間」的 `today` 改用偏好時區的今天。
   - 「週期」的開始日改用租戶時區的今天（預覽 API 已回傳 `timeZone`）；做不到時至少與偏好時區一致。

## 驗證方式

- `packages/web-shared/src/date/__tests__/date.test.ts`：若新增 `todayInZone()`，補跨日的案例。
- `apps/backstage/src/features/file/pages/FileManager/__tests__/FileShareDialog.test.tsx`：
  偏好時區設成和測試環境不同（例：`setDateTimeDefaults({ timeZone: 'America/Los_Angeles' })`），斷言送出的 `expiresAt` 是該時區當天的結束，顯示的日期也正確。
