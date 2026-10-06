# 非路由的表單對話框與頁內草稿沒有未儲存提醒

## 現況

`useUnsavedChangesGuard`（`packages/web-core/src/router/useUnsavedChangesGuard.ts`）只攔路由導覽。
它的前提是「表單類對話框都是路由」（註解 L11；[`frontend/04-routing.md`](../architecture/frontend/04-routing.md) §2.1「對話框即路由」）。
下面這些表單用 `useState` 開關，或直接放在頁面裡，沒有任何保護。

以 state 開關的對話框（Esc、點遮罩、取消都直接丟掉輸入）：

| 對話框 | 開啟的地方 | 關閉 |
| --- | --- | --- |
| 外部 IdP 連線（約 10 個欄位，含 client secret） | `apps/backstage/src/features/identity-provider/pages/IdentityProviderList/page.tsx` L30–31 | `components/IdentityProviderFormDialog.tsx` L145 |
| 標籤 | `apps/backstage/src/features/tag/pages/TagList/page.tsx` L55 | `components/TagFormDialog.tsx` L63 |
| 建立 API token（表單階段） | 個人資料、服務帳號 | `apps/backstage/src/core/components/ApiToken/ApiTokenCreateDialog.tsx` L94、L106 |
| 建立租戶 | `apps/platform/src/features/tenant/pages/TenantList/page.tsx` L30 | `components/CreateTenantDialog.tsx` L99 |
| 新增、編輯平台管理者 | `apps/platform/src/features/platform-admin/pages/PlatformAdminList/page.tsx` L29–30 | `components/CreatePlatformAdminDialog.tsx` L74、`EditPlatformAdminDialog.tsx` L80 |
| 租戶改名 | `apps/platform/src/features/tenant/pages/TenantDetail/components/TenantDetailHeader.tsx` L115 | `RenameTenantDialog.tsx` L50 |
| 租戶的功能參數 | 同目錄 `TenantFeatures.tsx` L95 | `TenantFeatureParamDialog.tsx` L81 |

頁內的草稿（有「捨棄／儲存」列，但換頁不會問）：

- 系統設定：`apps/backstage/src/features/system/pages/SettingList/components/SettingCategoryForm.tsx`，草稿在 L24（`useSettingDraft`），儲存列在 L74–95。
- 事件通知：`apps/backstage/src/features/notification/pages/NotificationEventList/page.tsx`，草稿在 L25（`useNotificationEventDraft`），儲存列在 L76–89。

是路由對話框，但沒有呼叫 guard：

- 審批詳情：`apps/backstage/src/features/approval/pages/ApprovalDetail/page.tsx`。審核意見與指派的角色存在 `useApprovalReview.ts`（L14–15），關閉時不會詢問。

另外，platform 在 session 結束時導向登入頁沒有帶 `ignoreBlocker`，另記於 [`platform-session-end-blocked-by-guard.md`](./platform-session-end-blocked-by-guard.md)。

## 影響

- 輸入到一半的管理者，只要誤按 Esc、點到遮罩，或在設定頁點了側邊選單，輸入就沒了，沒有任何提示。
- 影響最大的是：
  - 外部 IdP 表單：欄位多，client secret 還要回 IdP 重新取得。
  - 系統設定與事件通知：常一次改好幾項。

## 修正方式

state 對話框，擇一（建議 1）：

1. 在 web-core 加一個給 state 對話框用的 hook，例如 `useDialogUnsavedGuard(isDirty, onClose)`：
   - 回傳包好的 `onOpenChange`；dirty 時先用 `useConfirm` 問「要放棄變更嗎？」，文案沿用 `common.unsaved.*`。
   - 內部同時呼叫 `useUnsavedChangesGuard(isDirty)`，處理換頁與 `beforeunload`。
   - 上表的對話框改用它。
2. 把這些對話框改成路由（對話框即路由），直接用現有的 `useUnsavedChangesGuard`。

頁內草稿與審批詳情：

- `SettingCategoryForm`、`NotificationEventListPage` 以 `draft.isDirty` 呼叫 `useUnsavedChangesGuard`。設定頁有多個分類，任一分類 dirty 就要攔。
- 審批詳情在「有輸入意見或選了角色」時呼叫 `useUnsavedChangesGuard`；審核成功後的關閉（`useApprovalReview` 的 `onReviewed`）要帶 `ignoreBlocker: true`。

## 驗證方式

- 對話框的元件測試：輸入後按 Esc、按取消，出現 `unsaved-changes-confirm`；選「繼續編輯」後輸入仍在；沒有輸入時直接關閉。
  - 已有的測試檔：`apps/backstage/src/features/identity-provider/pages/IdentityProviderList/__tests__/IdentityProviderListPage.test.tsx`、
    `apps/backstage/src/features/tag/pages/TagList/__tests__/TagListPage.test.tsx`、`apps/backstage/src/core/components/ApiToken/ApiToken.test.tsx`、
    `apps/platform/src/features/platform-admin/pages/PlatformAdminList/__tests__/PlatformAdminListPage.test.tsx`。
- `apps/backstage/src/features/system/pages/SettingList/__tests__/SettingListPage.test.tsx`、
  `apps/backstage/src/features/notification/pages/NotificationEventList/__tests__/NotificationEventListPage.test.tsx`：改值後觸發導覽，出現確認。
- `apps/backstage/src/features/approval/pages/ApprovalDetail/__tests__/ApprovalReview.test.tsx`：輸入意見後關閉，出現確認；審核成功後關閉，不出現。
