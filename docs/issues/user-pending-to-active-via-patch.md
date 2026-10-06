# 管理者可以用 PATCH /users/:id 把 pending 的帳號直接改成 active，略過 email 所有權驗證

## 現況

`apps/api/src/modules/user/user.service.ts` 的 `update()`（L186 起）只要狀態有變就放行（L194–198），沒有看原本是不是 `pending`：

```ts
const statusChanging = dto.status !== undefined && dto.status !== user.status;
if (statusChanging) {
  this.assertNotSelf(actor.id, id);
  await this.assertCanManage(actor, id);
}
```

- `UpdateUserSchema`（`dto/update-user.dto.ts` L11–12）接受 `active`／`inactive`。註解寫「`pending` 只能由建立帳號產生、靠啟用信離開」。
- 前端（`apps/backstage/src/features/user/pages/UserDetail/components/UserBasicSection.tsx` L51–52）對 pending 的人不顯示狀態選單；後端沒有擋。
- 平台管理者有同一條規則，而且後端有擋：`platform-admin-management.service.ts` 的 `nextStatus()`（L179–187）對 pending 回 `VALIDATION_FAILED`。

註冊申請的帳號在核准時就存了申請人設定的密碼（`user-registration.approval.ts` 的 `apply()`，L86 起，`status: 'pending'`）。所以：

1. 有人以 `ceo@corp.com` 送出註冊申請，密碼自己設。
2. 審核者核准，帳號是 `pending`，啟用信寄到真正的 `ceo@corp.com`。
3. 持有 `user:update` 的人送 `PATCH /users/<id> { status: 'active', version }` → 200。`emitStatusChanged()` 還把這次修改當成「完成啟用」（L598）。
4. 申請人以自己設的密碼登入 `ceo@corp.com`，從頭到尾沒有收過那封信。

也可以分兩步：先 `PATCH { status: 'inactive' }`（`pending → inactive` 是允許的，會作廢啟用信），再 `PATCH { status: 'active' }`。
`users` 沒有「完成過啟用」的標記（`db/schema/users.ts` 只有 `password_hash`、`status`、`last_login_at`），
`inactive → active` 分不出這個人是「啟用後被停用」還是「從沒啟用過」，申請時存下的密碼雜湊一樣會生效。

## 影響

- [`rbac/06-approval.md`](../rbac/06-approval.md) §5 以「收得到信才證明擁有這個 email」防止有人用別人的 email 申請。這個前提被繞過，可以做出一個「看起來是某人、密碼卻在別人手上」的帳號。
- 之後本人以外部 IdP 登入時，自動連結（[`04-sso.md`](../architecture/04-sso.md) §3.3 第 2 步）會連到這個帳號，而密碼仍在申請人手上。
- 前提：持有 `user:update` 的人主動這樣做（誤操作、被社交工程，或本身就是共謀）。前端沒有這個按鈕，要直接呼叫 API。
- 管理者建立的帳號沒有密碼，改成 active 之後無法以密碼登入，但同樣跳過了啟用。

## 修正方式

- `update()` 在 `user.status === 'pending' && dto.status === 'active'` 時回 `400 VALIDATION_FAILED`（`fields.status`），與平台端的 `nextStatus()` 一致。
- `pending → inactive` 要保留：停用還沒啟用的人、並作廢他的啟用信是既有行為（`apps/api/test/account-security.spec.ts` L249 的案例）。
- 只擋第一點不夠，還要堵住兩步的繞道（`pending → inactive → active`），擇一：
  1. （建議）`pending → inactive` 時一併清掉 `password_hash`：之後就算改回 active，也只能經「重設密碼」設定密碼，等於仍要證明擁有這個 email。
  2. 新增「完成啟用」的標記（例：`activated_at`，由 `/auth/setup`、重設密碼、外部 IdP 登入寫入）；沒有這個標記的人，`inactive → active` 改回 `pending` 或拒絕。
- 文件同步：[`rbac/04-api-spec.md`](../rbac/04-api-spec.md) 的 `PATCH /users/:id` 一列（L111）補上「`pending` 不能直接改成 `active`」。

## 驗證方式

`apps/api/test/account-security.spec.ts` 的「還沒啟用的人」區塊（L318）補一個案例：

- 對 pending 的人 `PATCH { status: 'active' }` → 400。
- 狀態仍是 pending。
- 以申請時的密碼登入仍回 `AUTH_ACCOUNT_PENDING`。
- 兩步的案例：pending 的人先改成 inactive 再改成 active 之後，以申請時的密碼登入不會成功（依採用的方案，回 `AUTH_INVALID_CREDENTIALS` 或第二步就被拒絕）。
