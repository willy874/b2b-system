# 帳號存的語系與時區從沒被套用，偏好頁的時區也只能選 4 個

## 現況

### 1. 帳號的偏好沒有讀回來

- `GET /auth/profile` 有回 `user.preferences.{locale,timezone}`：`apps/api/src/modules/auth/dto/auth.dto.ts` L37、`auth.service.ts` L359。
- 前端沒有任何地方讀它。語系與時區只從 localStorage 來，沒有就用預設的 zh-TW 與 Asia/Taipei：
  `packages/web-core/src/store/preference.ts` 的 `hydratePreferences()`（L103–105）。

  ```ts
  useLocaleStore.setState({ locale: storage.get<Language>(LOCALE_KEY, DEFAULT_LANGUAGE) });
  useTimezoneStore.setState({ timezone: storage.get(TIMEZONE_KEY, DEFAULT_TIMEZONE) });
  ```

- 也沒有參考 `navigator.language`。
- 規格寫的偵測順序是「使用者偏好（後端）→ localStorage → `navigator.language` → 預設」（[`frontend/08-i18n.md`](../architecture/frontend/08-i18n.md) §1）。
  功能導覽也寫「語系與時區同步到帳號」（[`overview/05-feature-tour.md`](../overview/05-feature-tour.md) §7）。
- 後端寄信用的是帳號的語系：`apps/api/src/modules/approval/approval-result-mail.job.ts` L58、`apps/api/src/modules/credential/auth-mail.jobs.ts` L89。
- apps/platform 與 backstage 是不同的網域，localStorage 不共用。登入頁永遠用自己的設定，backstage 的語系帶不過去。

### 2. 偏好頁的時區寫死 4 個

- `apps/backstage/src/features/account/pages/Preference/page.tsx` L18、`apps/platform/src/features/account/pages/Preference/page.tsx` L14：

  ```ts
  const TIMEZONES = ['Asia/Taipei', 'Asia/Tokyo', 'UTC', 'America/Los_Angeles'];
  ```

- 同一個 app 的系統設定「預設時區」卻是完整、可搜尋的 IANA 清單：
  `apps/backstage/src/features/system/pages/SettingList/components/SettingField.tsx` 的 `timezoneOptions()`（L20–24）。

### 3. 「已儲存」不等結果

- backstage 偏好頁的語言（L52–55）與時區（L67–71）都先 `toast.success('已儲存')`，不等同步帳號的結果。
- 同步帳號的 `sync.mutate`（L69）與 `useChangeLocale()`（`apps/backstage/src/features/account/hooks/useChangeLocale.ts` L17–20、L26）都沒有 `onError`。

### 4. 租戶的預設時區沒有用在顯示上

- [`backend/12-settings.md`](../architecture/backend/12-settings.md) §5.3 已經寫明還沒接上。
- 但設定頁的說明（`setting.field.defaultTimezone.description`）寫「使用者沒有設定時區偏好時，用這個時區顯示時間」。

## 影響

- 英文使用者換電腦、換瀏覽器或清掉網站資料之後，介面回到中文、時區回到台北；收到的信卻是英文。
- 每次被導到 apps/platform 登入時，登入頁都用 platform 自己的設定（預設中文）。
- 不在這 4 個時區的使用者（歐洲、印度、東南亞……）選不到自己的時區。
- 同步帳號失敗時仍顯示「已儲存」，要到換了裝置才發現沒存到。
- 管理者以為設了預設時區，使用者就會看到那個時區，實際上沒有作用。

## 修正方式

1. profile 水合時套用帳號的偏好（在 `useSyncPermissions` 裡，或另外加一個 `usePreferenceSync`）：
   - `locale` 在 `SUPPORTED_LANGUAGES` 之內才用；`timezone` 要 `Intl` 認得才用。
   - 本機已存的偏好與帳號不同時，擇一處理（建議 a，與「同步到帳號」的說法一致）：
     - a. 以帳號為準。
     - b. 提示使用者選一個。
   - 登入之前（platform 的登入頁）沒有帳號資料，語系改用 `navigator.language`，再退回預設。
2. 偏好頁的時區改用 `Intl.supportedValuesOf('timeZone')` 的可搜尋清單：把 `SettingField` 的 `timezoneOptions()` 搬到共用的地方，兩個 app 都用它。
3. `toast.success` 移到 mutation 的 `onSuccess`；`onError` 用 `useErrorToast`。
4. 導向 apps/platform 登入時帶語系參數（例：OIDC 的 `ui_locales`），登入頁依此切換。
5. 租戶的預設時區擇一：
   - 接進日期顯示：使用者沒選時區時用租戶的預設。
   - 或修改設定頁的說明，不要寫出還沒有的行為。

## 驗證方式

- profile 水合的測試：profile 回 `preferences.locale = 'en-US'`、本機沒有存過偏好時，`i18n.language` 變成 en-US；時區同理。
- `apps/backstage/src/features/account/pages/Preference` 的頁面測試（目前沒有，要新增）：
  - 時區選項包含 `Europe/Berlin`。
  - PATCH 回 500：不出現「已儲存」，改為出現錯誤提示。
- 若做第 4 點：platform 登入頁的測試，帶語系參數時以該語系顯示。
