# 還原使用者只對直接持有的角色做反提權，他的群組成員資格（含群組的角色）也一起恢復

## 現況

`apps/api/src/modules/user/user.service.ts` 的 `restore()`（L305 起）只檢查直接持有的角色（L313–318）：

```ts
const roles = await this.repo.listRoles(id); // heldBy()：只有直接持有
await this.permissionService.assertRolesAssignable(
  actor.id,
  roles.map((role) => role.id),
);
```

刪除使用者時不動 `relation_tuples`：

- `UserRepository.softDelete()`（`user.repository.ts` L247–257）只寫 `deleted_at` 與 `token_version`。
- `UserService.remove()`（L253 起）也沒有刪群組成員的邊。
- `group:<g>#member@user:<id>` 要到永久刪除時（`hardDelete()`，`user.repository.ts` L537–552）才會刪。

還原之後，主體閉包又走得到這些群組，以及群組（與上層群組）持有的角色。

重現：

1. 自訂角色「帳號管理」只有 `user:read`、`user:delete`。
2. Bob 在「Admins」群組（持有 admin），沒有直接持有的角色。刪除 Bob。
3. 持有「帳號管理」的人 `POST /users/<bob>/restore` → 200。
4. Bob 以原本的密碼登入（刪除不清密碼雜湊），經由群組取得 admin 的權限。

若 admin 是直接指派給 Bob 的，第 3 步會回 `403 AUTHZ_ESCALATION`（`apps/api/test/trash.spec.ts` L215 的案例）。

## 影響

- 違反 [`backend/05-rbac.md`](../architecture/backend/05-rbac.md) §4.1 的通則：把主體放進 `物件#關係` 取得的能力，操作者都要有。
- 也違反 [`backend/13-trash.md`](../architecture/backend/13-trash.md) §4.1 第 3 步：「不能藉還原讓人取得自己給不了的角色」。
- 還原等於把他放回群組。[`rbac/08-groups.md`](../rbac/08-groups.md) §2.1 對「加成員」與「還原群組」都要求這個檢查。
- 前提：
  - 操作者有 `user:delete`，但沒有那些群組的角色帶的權限。
  - 被還原的帳號由操作者本人或與他串通的人控制，例如已離職但仍知道密碼的人。
- super-admin 不受影響：群組不能持有 super-admin。

## 修正方式

`restore()` 在 `assertRolesAssignable` 之外，再檢查他直接所屬的群組：

1. 在 `UserRepository` 加一個方法，查 `relation_tuples` 裡 `isGroupMemberTuple()`、主體是 `user:<id>`、群組未刪除的邊。
2. 對每個群組呼叫 `permissionService.assertCanGrant(actor.id, [{ object: { type: 'group', id }, relation: 'member' }])`。
   - 寫法與 `GroupService.assertCanJoin()`（`group.service.ts` L371–377）相同。
   - 引擎會沿上層群組展開。

另外要決定一件事：把 `inactive` 改回 `active` 也會讓他的角色重新生效，目前只有 super-admin 的保護，沒有反提權。
要不要比照還原處理，一併寫進 [`backend/05-rbac.md`](../architecture/backend/05-rbac.md) §4.1。

文件同步：更新 [`backend/13-trash.md`](../architecture/backend/13-trash.md) §4.1 第 3 步，改成檢查角色與群組成員資格。

## 驗證方式

在 `apps/api/test/trash.spec.ts` 的「反提權：admin 不能還原持有 super-admin 的帳號」（L215）旁補：

- 使用者只經由群組持有 admin → 刪除 → 由只有 `user:delete` 的人還原 → `403 AUTHZ_ESCALATION`，帳號仍是刪除狀態。
- 同一個情境，由持有 admin 全部權限的人還原 → 200。
