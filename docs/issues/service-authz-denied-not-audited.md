# Service 層自己判斷權限的四個地方，拒絕時不寫 authz.denied，回應的 details 也不一致

## 現況

規格要求每一次授權拒絕都寫 `authz.denied`：

- [`backend/05-rbac.md`](../architecture/backend/05-rbac.md) 開頭（L22）：「每次拒絕都寫稽核」，資源層級的拒絕也一樣。
- 同一份的 §10 常見錯誤（L796）：403 時不留紀錄是錯的。
- [`backend/06-audit-log.md`](../architecture/backend/06-audit-log.md) §2.1（L29）把 `authz.denied` 列為必記，內容要有所需權限與缺少的權限。

Guard 照做：`apps/api/src/common/guards/permissions.guard.ts` L75–87，先 `recordSafely()`，再拋 `AUTHZ_FORBIDDEN { required, missing }`。

Service 層另外判斷權限的地方是各自手寫的，做法不一：

| 位置（`apps/api/src/modules/`） | 寫 `authz.denied` | `details` |
| --- | --- | --- |
| `role/role.service.ts` 的 `assertCanGrantPermissions()`（L532 起） | 有 | `{ required, missing }` |
| `trash/trash.service.ts` 的 `assertCanView()`（L181–196） | 有 | `{ required, missing }` |
| `authz-explain/authz-explain.service.ts` 的 `assertCanExplain()`（L45 起） | 有 | `{ required, missing }` |
| `file/file-access.service.ts` 的 `deny()`（L109–127） | 有 | 資源層級的 details |
| `approval/approval.service.ts` 的 `assertPermissions()`（L284–290） | **沒有** | `{ missing }` |
| `announcement/announcement.service.ts` 的 `assertCanPublish()`（L533–538） | **沒有** | `{ missing }` |
| `tag/tag.service.ts` 的 `list()`（L102） | **沒有** | 沒有 details |
| `user/user-tag.resource.ts` 的 `resolveEditable`（L38–45） | **沒有** | `{ missing }` |

```ts
// approval.service.ts L283–289：註解說「與 PermissionsGuard 相同的回應形狀」，但沒有 required，也沒有稽核
/** 與 `PermissionsGuard` 相同的回應形狀：`AUTHZ_FORBIDDEN` ＋ 缺少的權限。 */
private async assertPermissions(userId: string, keys: readonly PermissionKey[]): Promise<void> {
  …
  if (missing.length) throw new AppException('AUTHZ_FORBIDDEN', { missing });
}
```

標籤的兩條路由只宣告 `@Authenticated()`：`tag.controller.ts` L39–40 的 `GET /tags`，以及 L82–83 的 `PUT /tags/assignments/:resourceType/:resourceId`。所以 service 的判斷是唯一的權限檢查，這些拒絕在稽核裡完全看不到。同樣是貼標籤，檔案會經過 `FileAccessService` 留下紀錄，使用者不會。

## 影響

- 稽核軌跡不完整。例：
  - 持有 `approval:review`、沒有 `user:create` 的人去核准註冊申請（`approval.service.ts` L175）。
  - 沒有 `user:update` 的人去改使用者的標籤。

  兩者都回 403，但稽核頁查不到。
- 前端拿到的 `AUTHZ_FORBIDDEN` 有三種 `details` 形狀；`tag.service.ts` L102 連缺什麼都沒說，不符合 [`backend/05-rbac.md`](../architecture/backend/05-rbac.md) §3.1（要帶 `missing`）。
- 授權結果本身沒有錯，影響的是稽核與錯誤訊息。

## 修正方式

1. 在 `PermissionService` 加一個共用方法，例：`assertHasAll(actor, keys, { route })`。
   - super-admin 直接放行。
   - 缺少時用 `AuditService.recordSafely()` 寫 `authz.denied`（`metadata: { route, required, missing }`），再拋 `AUTHZ_FORBIDDEN { required, missing }`。
   - `PermissionModule` 與 `AuditLogModule` 都是葉節點，彼此依賴合乎 [`conventions/07-layer-dependencies.md`](../conventions/07-layer-dependencies.md) §4 的規則。
2. 上表八處都改用它。
   - `tag.service.ts` 的 `canBrowse` 改成回傳缺少的權限；或由登記方（`user-tag.resource.ts`、`file-tag.resource.ts`）直接呼叫共用方法。
3. `details` 一律帶 `required` 與 `missing`。

## 驗證方式

- `modules/permission/__tests__/permission.service.spec.ts`：共用方法補三個案例：放行、拒絕（檢查稽核內容與例外的 details）、super-admin。
- `approval.service.spec.ts`、`announcement.service.spec.ts`、`tag.service.spec.ts`：拒絕時有呼叫 `recordSafely`，`details` 帶 `required` 與 `missing`。
- `apps/api/test/approval-lifecycle.spec.ts`：沒有 `user:create` 的審核者核准註冊，回 403，並查得到 `authz.denied`。
