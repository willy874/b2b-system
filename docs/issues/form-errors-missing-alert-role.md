# 登入頁等表單的送出錯誤沒有 role="alert"，報讀器不會念出

## 現況

[`frontend/07-ui-system.md`](../architecture/frontend/07-ui-system.md) §5 規定：表單層級的錯誤區用 `role="alert"`。
已經做到的地方：

- backstage 的建立頁，例：`apps/backstage/src/features/user/pages/UserCreate/page.tsx` L206–209。這裡的寫法是常駐的 `<p role="alert" … empty:hidden>`。
- platform 的忘記密碼與重設密碼：`apps/platform/src/features/login/pages/ForgotPassword/page.tsx` L85、`ResetPassword/page.tsx` L119。

下列送出失敗的訊息只是一般的 `<p>`：

| 表單 | 位置 |
| --- | --- |
| 登入（帳密與外部 IdP） | `apps/platform/src/features/login/pages/Interaction/page.tsx` L255–263 |
| 申請帳號 | `apps/platform/src/features/login/pages/Register/page.tsx` L191–195 |
| 啟用帳號（設定密碼） | `apps/platform/src/features/login/pages/Setup/page.tsx` L122 |
| 審批的核准與駁回 | `apps/backstage/src/features/approval/pages/ApprovalDetail/components/ApprovalReviewForm.tsx` L68–72 |
| 外部 IdP 連線 | `apps/backstage/src/features/identity-provider/pages/IdentityProviderList/components/IdentityProviderFormDialog.tsx` L331 |
| 建立租戶 | `apps/platform/src/features/tenant/pages/TenantList/components/CreateTenantDialog.tsx` L173–179 |
| 新增平台管理者 | `apps/platform/src/features/platform-admin/pages/PlatformAdminList/components/CreatePlatformAdminDialog.tsx` L140–146 |
| 編輯平台管理者 | `apps/platform/src/features/platform-admin/pages/PlatformAdminList/components/EditPlatformAdminDialog.tsx` L165–171 |

登入頁：

```tsx
<p
  className="m-0 text-sm text-[var(--color-danger-text)]"
  data-testid="login-error"
  data-value={formError === undefined ? searchError : formError.code}
>
  {formError?.message ?? t(searchErrorKey ?? 'login.error.generic')}
</p>
```

送出時焦點留在送出鈕上（`Button` 在 `loading` 時保留焦點）。錯誤訊息出現在別的位置，報讀器不會有任何播報。

## 影響

- 使用報讀器的人：密碼打錯、帳號被鎖、申請失敗、審核失敗時聽不到原因，只覺得「按了沒反應」。
- 登入是每個人第一個接觸的表單，影響最大。

## 修正方式

1. 在 web-core 加一個共用的 `FormError` 元件：
   - 常駐的 `<p role="alert">`，沒有訊息時 `empty:hidden`（與 backstage 建立頁相同的寫法：元素先存在、內容改變時，報讀器比較確定會念）。
   - 可以帶 `data-testid` 與 `data-value`（錯誤碼）。
2. 上表的表單改用它。登入頁保留 `login-error` 的 testid 與 `data-value`。

## 驗證方式

- `apps/platform/src/features/login/pages/Interaction/__tests__/InteractionPage.test.tsx`：密碼錯誤後，`getByRole('alert')` 存在，文字是錯誤訊息，`data-value` 是錯誤碼。
- `apps/platform/src/features/login/pages/Setup/__tests__/SetupPage.test.tsx`：送出失敗後 `getByRole('alert')` 有錯誤訊息。
- 其他表單（申請帳號、審批、外部 IdP、建立租戶、平台管理者）的測試補同樣的斷言；申請帳號目前沒有頁面測試，要新增。
