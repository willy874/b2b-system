# 只顯示一次的 API token 與 Webhook 密鑰，按 Esc 或點遮罩就會被關掉

## 現況

API token 與 Webhook 簽章密鑰的明文，只在建立或輪替的回應裡出現一次：
[`06-external-api.md`](../architecture/06-external-api.md) §9.2 D7、§9.8 T4；[`backend/17-webhook.md`](../architecture/backend/17-webhook.md) §6。
畫面上的提示也寫「只會顯示這一次」。但顯示明文的對話框都可以用 Esc 或點遮罩關閉，一關閉明文就丟了：

1. API token：`apps/backstage/src/core/components/ApiToken/ApiTokenCreateDialog.tsx`
   - `changeOpen(false)`（L64–67）會呼叫 `reset()`，把 `created` 清掉（L61）。
   - Dialog 的 `onOpenChange={changeOpen}`（L94）不區分「我已保存」（L101）與 Esc、點遮罩。
   - 兩處共用這個元件：個人資料（`apps/backstage/src/features/account/pages/Profile/components/ProfileApiTokenSection.tsx` L39）、
     服務帳號（`apps/backstage/src/features/service-account/pages/ServiceAccountDetail/components/ServiceAccountTokenSection.tsx` L71）。

   ```ts
   const changeOpen = (next: boolean) => {
     if (!next) reset();
     onOpenChange(next);
   };
   ```

2. 輪替 Webhook 密鑰：`apps/backstage/src/features/webhook/pages/WebhookDetail/components/WebhookSettingsSection.tsx`
   - 確認輪替後 `setSecret(result.secret)`（L140）。這時舊密鑰已經失效。
   - 新密鑰的對話框 `onOpenChange={(open) => !open && setSecret(undefined)}`（L330）。

3. 建立 Webhook：建立成功之後的關閉一樣會丟掉密鑰，原因是 `ignoreBlocker`，見 [`route-dialogs-bypass-unsaved-guard.md`](./route-dialogs-bypass-unsaved-guard.md)。

另外，`packages/ui/src/components/Dialog/Dialog.tsx` 的 `dismissible`（L23–24）只對應到 `disablePointerDismissal`（L52），Esc 照樣會關閉。
規格 [`frontend/07-ui-system.md`](../architecture/frontend/07-ui-system.md) §3.2 的寫法是「點擊遮罩或按 Esc 是否關閉」。
所以就算設了 `dismissible={false}`（例：`apps/platform/src/features/tenant/pages/TenantDetail/components/DeleteTenantDialog.tsx` L52），也擋不住 Esc。

重現（輪替）：

1. 打開 Webhook 詳情，按「輪替密鑰」並確認。
2. 新密鑰的對話框出現。還沒複製就按 Esc。
3. 對話框關閉，新密鑰再也看不到；舊密鑰已經失效。

## 影響

- 建立 API token 的人：還沒保存 token 就沒了，只能撤銷再建一把。
- 輪替 Webhook 密鑰的人：接收端拿不到新密鑰，之後的投遞都會驗章失敗，只能再輪替一次。
- 前提是誤按 Esc 或點到遮罩。提示文字已經寫了「只會顯示這一次」，但沒有防呆。

## 修正方式

1. 這三個對話框在顯示明文時，只允許「我已保存／完成」關閉。Esc 與點遮罩擇一處理（建議 a）：
   - a. 忽略，不關閉。
   - b. 先用 `useConfirm` 問「密鑰還沒保存，確定要關閉？」。
2. `Dialog` 的 `dismissible={false}` 依規格同時擋 Esc：`onOpenChange` 的第二個參數 `eventDetails.reason` 是 `escape-key` 或 `outside-press` 時，`dismissible` 為 false 就不往外傳。
   改完之後，`DeleteTenantDialog` 等既有用法也一併符合規格。

## 驗證方式

- `apps/backstage/src/core/components/ApiToken/ApiToken.test.tsx`：建立成功後按 Esc、點遮罩，token 仍在畫面上；按「我已保存」才關閉。
- `apps/backstage/src/features/webhook/pages/WebhookDetail/__tests__/WebhookDetailPage.test.tsx`：輪替後按 Esc，密鑰仍在畫面上。
- `packages/ui/src/components/Dialog/Dialog.test.tsx`：`dismissible={false}` 時按 Esc，不呼叫 `onOpenChange(false)`。
