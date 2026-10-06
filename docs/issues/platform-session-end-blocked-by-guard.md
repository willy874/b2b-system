# apps/platform 的 SessionWatcher 導向登入頁沒有略過未儲存提醒，改密碼成功每次都跳出「要放棄變更嗎？」

## 現況

- `apps/platform/src/app/App.tsx` 的 `SessionWatcher`（`ended` 的處理在 L42–50）在 session 結束時導向登入頁，**沒有帶 `ignoreBlocker`**：

  ```ts
  sessionStore.events.on('ended', (reason) => {
    usePermissionStore.getState().clear();
    queryClient.clear();
    void router.navigate({
      to: '/login',
      search: loginSearchAfterSessionEnd(reason, globalThis.location),
      replace: true,
    });
  }),
  ```

- backstage 的同一段（`apps/backstage/src/app/App.tsx` L44–54）有帶 `ignoreBlocker: true`（L52），並註明「session 已經結束：未儲存提醒留不住使用者，直接離開」。
  這是 09-30 的 `8642a8ef`（EDGE-26）加上的；apps/platform 的個人資料頁之後才出現，這一段沒有跟上。
- 規格與同步規則都要求兩邊一致：
  - [`frontend/04-routing.md`](../architecture/frontend/04-routing.md) §2.1：「session 結束導向登入頁時也略過」未儲存提醒。
  - [`frontend/17-shared-packages.md`](../architecture/frontend/17-shared-packages.md) §5 與 [`apps/platform/README.md`](../../apps/platform/README.md) 的「同步規則」：`SessionWatcher` 要兩個 app 一起看。
- 平台的個人資料頁 `apps/platform/src/features/account/pages/Profile/page.tsx` 掛了未儲存提醒（L83）：

  ```ts
  useUnsavedChangesGuard(profileDirty || currentPassword.length > 0 || newPassword.length > 0);
  ```

為什麼改密碼成功 **每次** 都會被擋：

1. `submitPassword()` 的 `onConfirm`（L94–111）成功後，先 `setCurrentPassword('')` 等清空欄位（L106–108），接著同步呼叫 `sessionStore.endSession(PASSWORD_CHANGED_REASON)`（L110）。
2. 這時 state 還沒 commit。`packages/web-core/src/router/useUnsavedChangesGuard.ts` 的 `dirtyRef` 要等 `useLayoutEffect`（L19–21）才更新，所以仍是 `true`。
3. `endSession()` 觸發 `ended`，接著 `router.navigate()` → `commitLocation()` → `history.replace()`，全程同步。
   `@tanstack/history` 的 `tryNavigation()` 只有 `ignoreBlocker` 會略過 blocker；`shouldBlockFn`（L24–25）當下讀到的 `dirtyRef.current` 是 `true`。
4. 結果跳出「要放棄變更嗎？」。按「繼續編輯」就停在 session 已結束、快取已清空的頁面。

- `session.revoked` 推播比 HTTP 回應先到時（`expectSessionEnd()` 處理的情況），密碼欄位還有值，一樣會被擋。
- 其他結束原因（帳號被停用、續期被拒、單一登出）也一樣：只要當下表單是 dirty（顯示名稱改了沒存、密碼欄有輸入）就會被擋。
- 測試沒有抓到這個問題：
  - `apps/platform/src/features/account/pages/Profile/__tests__/ProfilePage.test.tsx`（L92–103）把 `endSession` mock 掉，沒有經過 `SessionWatcher`。
  - E2E 只測 backstage 的改密碼（`apps/e2e/tests/account.spec.ts` L46–61）。

重現步驟：

1. 平台管理者登入 apps/platform，打開「個人資料」。
2. 輸入目前密碼與新密碼，按「變更密碼」並確認。
3. 改密碼成功後跳出「要放棄變更嗎？」，而不是直接到登入頁顯示「密碼已變更」。
4. 按「繼續編輯」：留在個人資料頁，但 session 已結束，之後的操作都會失敗。

## 影響

- 平台管理者每次改密碼成功都會遇到，流程看起來像出錯。
- session 因安全原因結束（停用、撤銷）時，畫面停在原頁、不離開，使用者可能以為自己還登入著。
  快取雖已清空，畫面仍顯示原本載入的內容（目前是本人的個人資料）。
- 兩個 app 的 `SessionWatcher` 已經分岔，同步規則沒有守住；之後只改一邊時，容易再漏掉另一邊。

## 修正方式

1. 立即：`apps/platform/src/app/App.tsx` 的 `ended` 導覽加 `ignoreBlocker: true`，與 backstage 相同。
2. 根本（建議一起做）：把 `SessionWatcher` 搬進 `packages/web-core/src/shell`，兩個 app 共用一份。
   - 參數：登入頁路徑（`/auth/login`、`/login`）、`isPublic()`，以及各 app 額外的同步 hook（權限水合，與 backstage 的 `useSyncFeatures`）。
   - 搬完後，從 17-shared-packages.md §5「仍各自一份的部分」與 apps/platform/README.md 的「同步規則」移除 `SessionWatcher`。

## 驗證方式

- 新增 `SessionWatcher` 的測試（apps/platform 的 `app/__tests__/`，搬進 web-core 後改放 `packages/web-core/src/shell/__tests__/`）：
  在掛了 `useUnsavedChangesGuard(true)` 的 route 上呼叫 `sessionStore.endSession(...)`，斷言導到 `/login`，而且沒有出現 `unsaved-changes-confirm`。
- `ProfilePage.test.tsx`：補一個不 mock `endSession` 的案例，在真的 router 下斷言改密碼成功後導到 `/login`，`reason=password_changed`。
- E2E：比照 `apps/e2e/tests/account.spec.ts`（L46–61），補平台管理者在 apps/platform 改密碼的案例。
  斷言網址到 `/login?…signedOut=true…reason=password_changed`，過程中沒有 `unsaved-changes-confirm`。
