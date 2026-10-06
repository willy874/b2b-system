# 放在 Field 裡的 Select 沒有連上欄位標籤與錯誤訊息

## 現況

`packages/ui/src/components/Field/Field.tsx` 使用 Base UI 的 `Field.Label`、`Field.Description`、`Field.Error`。
這些元件要靠控制項「向 Field 登記自己的 id」才能關聯起來。
`Input`（Base UI Input）、`NumberField`、`Checkbox`、`Switch` 會登記，所以標籤與 `aria-describedby` 都正確。

自製的 `Select`（`packages/ui/src/components/Select/Select.tsx`）不會登記：

- 觸發鈕是 Base UI 的 `Popover.Trigger`（L697–716），只吃呼叫端傳的 `aria-label`。

  ```tsx
  <BasePopover.Trigger
    role="combobox"
    aria-label={ariaLabel}
    aria-invalid={invalid || undefined}
  ```

- 結果 `<label for>` 指向一個不存在的 id，Field 的說明與錯誤也不會出現在 `aria-describedby`。

以暫存測試在 jsdom 確認：

- `<Field label="時區"><Select … /></Field>`：`<label for="base-ui-_r_0_">`，combobox 的 id 是 `base-ui-_r_4_`。
  `getByRole('combobox', { name: /時區/ })` 找不到，`aria-describedby` 是 null。
- 同樣的寫法改包 `Input`：找得到，也有 `aria-describedby`。

放在 Field 裡、又沒有傳 `aria-label` 的 Select，報讀器只會念出目前的值：

- backstage（路徑在 `apps/backstage/src/features/` 之下）：
  - 偏好頁的語言、時區、主題：`account/pages/Preference/page.tsx` L50、L65、L79
  - 使用者狀態：`user/pages/UserDetail/components/UserBasicSection.tsx` L188
  - 建立使用者的角色：`user/pages/UserCreate/page.tsx` L190（`UserRoleSelect` 把其餘 props 傳給 Select）
  - 審批時指派的角色：`approval/pages/ApprovalDetail/components/ApprovalReviewForm.tsx` L32
  - 公告的收件對象：`announcement/components/AudiencePicker.tsx` L75、L92、L109
  - 外部 IdP 的「找不到帳號時」：`identity-provider/pages/IdentityProviderList/components/IdentityProviderFormDialog.tsx` L318
  - 存取申請的等級：`file/pages/FileManager/components/FileAccessRequestDialog.tsx` L75
  - 系統設定的預設時區：`system/pages/SettingList/components/SettingField.tsx` L114（Select 先存在 `control` 變數，再放進 L133 的 `Field`）
- platform（路徑在 `apps/platform/src/features/` 之下）：
  - 平台管理者的角色與狀態：`platform-admin/pages/PlatformAdminList/components/CreatePlatformAdminDialog.tsx` L130、`EditPlatformAdminDialog.tsx` L121、L137
  - 偏好頁的三個欄位：`account/pages/Preference/page.tsx` L44、L59、L71

有傳 `aria-label` 的 Select（例：`ApiTokenCreateDialog`）有名稱，但 Field 的說明與錯誤一樣連不上。

`DatePicker`、`DateRangePicker` 的觸發鈕也是 `Popover.Trigger`，有同樣的限制；目前使用處都有傳 `aria-label`。

規格：[`frontend/07-ui-system.md`](../architecture/frontend/07-ui-system.md) §5 規定表單標籤一律用 `Field.Label`，`Field.Error` 以 `aria-describedby` 連到輸入元素。

## 影響

- 使用報讀器的人聽到「UTC，下拉方塊」，而不是「時區」；欄位錯誤（例：建立使用者時角色的錯誤）不會被念出。
- 使用語音控制的人無法用欄位名稱操作這些下拉。點標籤也不會聚焦到下拉。
- 涵蓋兩個 app 的偏好頁，以及使用者、審批、公告、IdP、平台管理者等表單。

## 修正方式

在 `packages/ui` 修一次，所有使用處就會一起修好：

1. `Field` 另外提供自己的 context：標籤 id、說明 id、錯誤 id、是否有錯。`Field.Label`、`Field.Description`、`Field.Error` 都可以帶指定的 id。
2. `Select` 讀這個 context：
   - 沒有 `aria-label` 時，設 `aria-labelledby` 為標籤的 id。列表（listbox）也一樣。
   - `aria-describedby` 帶說明與錯誤的 id。
   - Field 有錯時設 `aria-invalid`。
3. `DatePicker`、`DateRangePicker` 一起接上。

## 驗證方式

- `packages/ui/src/components/Select/Select.test.tsx`：
  - 在 `<Field label="時區">` 裡，`getByRole('combobox', { name: '時區' })` 找得到。
  - Field 帶 `error` 時，combobox 的 `aria-describedby` 指向錯誤訊息，`aria-invalid="true"`。
- `packages/ui/src/components/DatePicker/DatePicker.test.tsx`：同樣的兩個案例。
