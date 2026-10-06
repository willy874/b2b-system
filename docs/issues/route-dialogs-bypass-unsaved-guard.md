# 建立 Webhook、建立與編輯公告時，取消、Esc 或點遮罩都不會觸發未儲存提醒

## 現況

`useUnsavedChangesGuard`（`packages/web-core/src/router/useUnsavedChangesGuard.ts`）靠 TanStack Router 的 blocker 攔導覽。
帶 `ignoreBlocker: true` 的導覽不會被攔。這個 hook 的註解（L11–12）與 [`frontend/04-routing.md`](../architecture/frontend/04-routing.md) §2.1 都規定：只有「儲存成功後的關閉」才帶它。

下面三個路由對話框的 `close` 一律帶 `ignoreBlocker: true`，而取消鈕、Esc、點遮罩都走 `close`：

- `apps/backstage/src/features/webhook/pages/WebhookCreate/page.tsx`
  - guard 在 L40–42，註解寫「密鑰顯示中也要擋：關掉就再也看不到」。
  - `close` 在 L44；L69 的 `onOpenChange` 與 L85 的取消鈕都呼叫它。
  - 建立成功之後，L69 改呼叫 `openDetail()`（L45–51），一樣帶 `ignoreBlocker`。

  ```ts
  const close = () => void navigate({ to: WebhookListRoute.to, search, ignoreBlocker: true });
  onOpenChange={(open) => !open && (created ? openDetail(created.webhook.id) : close())}
  ```

- `apps/backstage/src/features/announcement/pages/AnnouncementCreate/page.tsx`：guard 在 L31，`close` 在 L34，由 L55（`onOpenChange`）、L62（取消鈕）呼叫。
- `apps/backstage/src/features/announcement/pages/AnnouncementDetail/page.tsx`：`close` 在 L26，由 L31（`onOpenChange`）、L36（關閉鈕）呼叫。
  這讓 `components/AnnouncementSettingsSection.tsx` 編輯中的 guard（L67）失效。

其他建立頁的取消會被攔下，只有成功後才帶 `ignoreBlocker`：`UserCreate/page.tsx` 的 `close(options?)`（L60–61）、`RoleCreate`、`GroupCreate`、`ServiceAccountCreate`。

結果這三頁的 guard 只攔得到「瀏覽器上一頁」與「點側邊選單」。

重現：

1. 打開「建立公告」，輸入標題與內文。
2. 按 Esc，或點遮罩、按取消。
3. 對話框直接關閉，沒有出現「要放棄變更嗎？」。

## 影響

- 寫公告的人：標題、最多 5000 字的內文、收件對象與排程，一個 Esc 就全部遺失。
- 編輯公告設定的人：同上。
- 建立 Webhook 的人：
  - 表單填到一半會遺失。
  - 建立成功後按 Esc 或點遮罩，一次性的簽章密鑰還沒複製就再也看不到。另見 [`one-time-secrets-dismissible.md`](./one-time-secrets-dismissible.md)。

## 修正方式

1. 三頁的 `close` 改成和 `UserCreate` 一樣的形狀：`close(options?: { ignoreBlocker?: boolean })`。
   只有成功後的導覽傳 `ignoreBlocker: true`：
   - WebhookCreate 的「完成」鈕（`openDetail`）。
   - AnnouncementCreate 建立成功後的導覽（L41–46 已經自己帶了）。
   - AnnouncementDetail 刪除後的關閉（L63 `onDeleted={close}` 要改成帶 `ignoreBlocker`）。
2. WebhookCreate 建立成功之後，除了「完成」以外的關閉途徑都讓 guard 攔下。確認文案可以另外說明「密鑰還沒保存」。

## 驗證方式

比照 `apps/backstage/src/features/role/pages/RoleCreate/__tests__/RoleCreatePage.test.tsx` 的「勾了權限後點取消會先確認」，補在：

- `apps/backstage/src/features/announcement/pages/AnnouncementCreate/__tests__/AnnouncementCreatePage.test.tsx`
- `apps/backstage/src/features/announcement/pages/AnnouncementDetail/__tests__/AnnouncementDetailPage.test.tsx`（編輯中）
- `apps/backstage/src/features/webhook/pages/WebhookCreate/__tests__/WebhookCreatePage.test.tsx`

案例：

- dirty 時按 Esc、按取消：出現 `unsaved-changes-confirm`；選「繼續編輯」之後，對話框與輸入都還在。
- 儲存成功後關閉：不出現確認。
- WebhookCreate 建立成功之後按 Esc：出現確認。
