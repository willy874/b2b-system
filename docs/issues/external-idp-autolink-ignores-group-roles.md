# 外部 IdP 以 email 自動連結時只排除直接持有的系統角色，經由群組持有 admin 的帳號仍會被連結

## 現況

`apps/api/src/modules/auth/external-login.service.ts` 的 `assertLinkable()`（L342–354）以 `listRoleSummaries()` 判斷帳號持有的角色：

```ts
const roles = await this.users.listRoleSummaries(user.id);
if (roles.some((role) => role.isSystem && role.slug !== MEMBER_SLUG)) {
  throw new AppException('AUTH_SSO_LINK_NOT_ALLOWED');
}
```

- `listRoleSummaries()` 就是 `UserRepository.listRoles()`（`apps/api/src/modules/user/user.repository.ts` L293–301），條件是 `heldBy(userId)`（L105–107）。
- `heldBy` 用的是 `isRoleHolderTuple()`：`subject_type = 'user'`、`subject_relation = ''`，只看得到 **直接** 指派的角色。
- 群組持有角色的邊 `role:<admin>#holder@group:<g>#member` 不在結果裡。但 [`rbac/08-groups.md`](../rbac/08-groups.md) §1 的定義是「g 的成員都持有 r」。
- `apps/api/test/sso-external.spec.ts` 只測了直接指派的 super-admin、admin（L482–518）。

攻擊步驟（攻擊者持有 `identityProvider:create` 或 `identityProvider:update`）：

1. 把登記 `corp.com` 的連線改指向自己架的 IdP（改 issuer；`identity-provider.service.ts` 的 `update()` 會清掉這個連線既有的連結，L162–166），或把網域移到自己新建的連線。
2. 在登入互動選這個連線，由自架 IdP 對 `victim@corp.com` 簽出 `email_verified = true`。
3. `resolveAccount()`（L243 起）的第 2 步找到既有帳號。victim 的 admin 來自「Admins」群組，`assertLinkable()` 放行。
4. 連結建立，攻擊者以 victim 的身分登入，經由群組取得 admin 的權限。

同樣的步驟用在「直接持有 admin」的帳號，會得到 `AUTH_SSO_LINK_NOT_ALLOWED`。

## 影響

- 繞過 [`04-sso.md`](../architecture/04-sso.md) §3.3 的保護：「持有 super-admin、admin、auditor 的帳號即使網域相符也不自動連結」。
- 前提：
  - 攻擊者能新增或修改外部 IdP 連線（預設只有 admin 有 `identityProvider:create`／`update`）。
  - 被接管的人經由群組（含巢狀）持有 `member` 以外的系統角色，而且還沒有連結這個連線。
- 自訂一個只管外部 IdP 的角色時，這是垂直提權，可以升到 admin。
- admin 之間則是冒名，例如以另一位 admin 的身分核准自己的申請，繞過四眼原則。
- super-admin 不受影響：群組不能持有 super-admin（[`rbac/08-groups.md`](../rbac/08-groups.md) §2.1 D12）。

## 修正方式

`assertLinkable()` 改以主體閉包判斷帳號持有的角色，包括直接持有與經由群組持有：

1. `ExternalLoginService` 注入 `PermissionService`，取 `getPermissionSet(user.id).subjects`。`resolveAccount()` 已經在那個租戶的脈絡裡執行。
2. 從 `subjects` 取出 `role:<id>#holder`（`parseSubjectKey`），查這些角色。有任何一個 `isSystem && slug !== 'member'` 就拒絕。

也可以在 `UserRepository` 加一個 `listEffectiveRoles()`，沿 `MEMBERSHIP_STEP` 遞迴（條件與 `AuthzRepository.subjectClosures` 相同）。
擇一；建議前者，不必再維護一份遞迴查詢。

文件同步：[`04-sso.md`](../architecture/04-sso.md) §3.3 與 [`backend/04-auth.md`](../architecture/backend/04-auth.md) §8.1 補一句「持有」含經由群組。

## 驗證方式

在 `apps/api/test/sso-external.spec.ts` 的「持有 admin（member 以外的系統角色）一樣不自動連結」（L502）旁補兩個案例：

- 帳號只經由群組持有 admin（插入 `groupMemberTuple` 與 `groupRoleTuple`）→ `AUTH_SSO_LINK_NOT_ALLOWED`，`user_identities` 沒有新增的列。
- 巢狀群組（帳號在 H、H 在 G、G 持有 auditor）→ 同上。
