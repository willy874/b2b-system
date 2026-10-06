# 日期選擇器、TreeEditor 與 Spinner 的預設文案沒有跟著語系

## 現況

`@b2b-system/ui` 的預設文案是寫死的。web-core 以 `ComponentLabelsContext` 傳入目前語系的文案（`packages/web-core/src/shell/ComponentLabelsHost.tsx`），
但 context 只涵蓋必填標記、Select、Toast、分頁（`packages/ui/src/components/labels.ts`）。下列元件不在其中，呼叫端也沒有傳：

### 1. 日曆的語系固定是中文

- `packages/ui/src/components/DatePicker/Calendar.tsx` L64：`locale = 'zh-TW'`。
- `DatePicker.tsx`（L89）與 `DateRangePicker.tsx`（L112）會把自己的 `locale` prop 往下傳，但沒有任何呼叫端傳 `locale`。
- 結果英文介面的月份標題與星期是「2026年10月」「日一二三四五六」。

### 2. 日期選擇器的按鈕名稱固定是英文

- `Calendar.tsx` L67：`labels = { previousMonth: 'previous month', nextMonth: 'next month' }`。`DatePicker` 與 `DateRangePicker` 都不會把 labels 傳給 `Calendar`。
- `DatePicker.tsx` L53、`DateRangePicker.tsx` L57：`{ clear: 'clear', open: 'open calendar' }`。
- 沒有傳 `labels` 的呼叫端：
  - `apps/backstage/src/features/file/pages/FileManager/components/FileShareDialog.tsx` L325
  - `apps/backstage/src/features/announcement/components/TriggerField.tsx` L196、L393、L403
- `packages/web-core/src/components/RichTable/FilterBar/FilterControl.tsx` L111 有傳 `clear`／`open`，但切換月份的按鈕仍是英文。
- 以暫存測試確認：DatePicker 清除鈕的名稱是 `clear`，觸發鈕是 `open calendar`。

### 3. TreeEditor 的工具列固定是中文

- `packages/ui/src/components/TreeEditor/TreeEditor.tsx` 的 `DEFAULT_LABELS`（L165–177）。
- 工具列只顯示圖示，這些字就是按鈕的名稱與提示（「放大」「縮小」「顯示全部」「更多」）。
- 兩處使用都沒有傳 `labels`：
  - `apps/backstage/src/features/role/components/PermissionSkillTree.tsx` L146
  - `apps/backstage/src/features/permission/pages/PermissionList/components/PermissionCatalogTree.tsx` L77

### 4. Spinner 的名稱固定是英文

- `packages/ui/src/components/Spinner/Spinner.tsx` L20：`aria-label={label ?? 'loading'}`。
- `packages/ui/src/components/Button/Button.tsx` L70：載入中渲染 `<Spinner size={14} />`，沒有 label。所以所有載入中的按鈕，可存取名稱都會多出英文的「loading」。
- 另有 6 處沒有傳 label：
  - `apps/backstage/src/features/file/pages/FileManager/components/FileAccessExplainSection.tsx` L80
  - `apps/backstage/src/features/file/pages/FileManager/components/FileShareDialog.tsx` L124
  - `apps/backstage/src/features/notification/components/NotificationList.tsx` L44（platform 的同名檔案 L45）
  - `apps/backstage/src/features/user/pages/UserDetail/components/UserPermissionSourceSection.tsx` L38
  - `apps/backstage/src/features/account/pages/Profile/components/ProfilePermissionSection.tsx` L40

規格：`labels.ts` 的檔頭寫「英文介面不會漏出中文預設文案」；[`frontend/08-i18n.md`](../architecture/frontend/08-i18n.md) §3.3；
[`conventions/02-frontend.md`](../conventions/02-frontend.md) §8：設計系統元件的預設文案可以寫死，但 `features/` 使用時必須以 `t()` 傳入。

## 影響

- 英文使用者：
  - 稽核日誌與通知總覽的日期篩選、資料夾授權的到期日、公告排程，日曆都是中文月份與星期。
  - 權限樹的縮放按鈕名稱與提示是中文。
- 中文的報讀器使用者：聽到英文的 previous month、clear、open calendar、loading。
- 只影響文案，不影響功能。

## 修正方式

在共用層修一次：

1. `ComponentLabels` 加上：日曆的上個月與下個月、日期選擇器的清除與開啟、TreeEditor 工具列、Spinner 的載入中，以及目前的語系（`locale`）。
   `ComponentLabelsHost` 以 `t()` 與 `language` 提供。
2. `Calendar`、`DatePicker`、`DateRangePicker`、`TreeEditor`、`Spinner` 在呼叫端沒有傳時，改用 context 的值。
3. `DatePicker`、`DateRangePicker` 把切換月份的文案往下傳給 `Calendar`。
4. web-core 的兩個語系檔補上這些鍵（`components.*`）。

## 驗證方式

- web-core 補 `ComponentLabelsHost` 的測試：切成 en-US 之後
  - 日曆標題是 `October 2026`，星期是英文。
  - 清除鈕的名稱是 `Clear`。
  - 載入中按鈕的名稱不含 `loading`（中文介面念「載入中」）。
- `packages/ui/src/components/DatePicker/DatePicker.test.tsx`：沒有傳 `locale` 時跟著 context 的語系。
- `packages/ui/src/components/Spinner/Spinner.test.tsx`：沒有傳 `label` 時用 context 的文案。
