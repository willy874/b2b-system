# 平台管理者的「最後一位 super-admin」檢查在交易外，兩位 super-admin 同時互相降級會都成功

## 現況

`apps/api/src/modules/platform-admin/platform-admin-management.service.ts` 的 `update()`（L81–149）先計數，再用另一條語句寫入。兩者不在同一個交易，也沒有鎖：

```ts
if (losesSuperAdmin && (await this.repo.countActiveSuperAdmins(id)) < 1) {   // L99
  throw new AppException('LAST_SUPER_ADMIN');
}
…
if (statusChanged && nextStatus === 'inactive') {
  await this.repo.updateAndEndSessions(id, patch, 'user_disabled');          // L113
} else {
  await this.repo.update(id, patch);                                         // L115
}
```

- `PlatformAdminRepository.countActiveSuperAdmins()`（`platform-admin.repository.ts` L147–160）直接查 `this.db`，不接受 `tx`，也不加鎖。
- L93 的註解寫「經 API 時一定還有另一位（執行者本人）」。這在並行時不成立：執行者本人可能同時被別人降級。
- 租戶端同一條規則（[`backend/05-rbac.md`](../architecture/backend/05-rbac.md) §8.2）是在寫入的交易內先取 advisory lock 再計數：
  - `user.service.ts` 的 `assertNotLastSuperAdmin()`（L646–651）
  - `user.repository.ts` 的 `lockSuperAdminGuard()`（L381–383）
  - 並行測試：`test/account-security.spec.ts`（L395）
- 平台端這三者都沒有。`test/platform-admin.spec.ts` 也沒有任何 `LAST_SUPER_ADMIN` 的案例。

重現（三位檢測者各自獨立發現；其中一位在 scratch 環境用並行請求重現：兩個請求都回 200，結束後 active 的 super-admin 是 0）：

1. 平台上只有兩位 active 的 super-admin：A、B。
2. A 送 `PATCH /platform/admins/<B> { role: 'operator' }`，B 同時送 `PATCH /platform/admins/<A> { status: 'inactive' }`。
3. 兩邊計數時，排除目標之後都還有 1 位（對方），所以都通過，兩個寫入都提交。
4. 平台上沒有任何 active 的 super-admin。

## 影響

- 前提：兩位 super-admin 幾乎同時操作對方，機率低。若之後開放其他角色管理管理者（L94 的註解預期這種情況），風險會變高。
- 後果不可逆：
  - `platformAdmin:create`、`platformAdmin:update` 只有 super-admin 有（`db/seeds/platform-permissions.ts` 的 `PLATFORM_ROLE_PERMISSIONS`，L37 起）。沒有人能再新增、啟用或升級管理者。
  - `db:seed` 的 `seedPlatformAdmin()`（`db/seeds/platform-admin.ts` L14–22）只在平台上一位管理者都沒有時才建立，救不回來。只能直接改資料庫。
- 這正是 [`backend/05-rbac.md`](../architecture/backend/05-rbac.md) §8.2 說要防的 check-then-act。

## 修正方式

照租戶端的寫法：

1. `PlatformAdminRepository` 加 `lockSuperAdminGuard(tx)`，在平台 DB 執行 `SELECT pg_advisory_xact_lock(hashtext('platform_super_admin_guard'))`。`countActiveSuperAdmins()` 改成接受 `tx`。
2. `update()` 改在一個平台 DB 交易內依序執行：鎖 → 計數 → 寫入 → 稽核（`audit.record(…, tx)`）。停用時，遞增 `token_version` 與撤銷 refresh token 也放在同一個交易。交易提交後才失效快取、發事件、寫平台通知。
3. `updateAndEndSessions()`（L112–122）現在是 repository 自己開交易，要拆回 service 編排，第 2 步才能把它放進同一個交易。這一步與 [`platform-account-flows-not-transactional.md`](./platform-account-flows-not-transactional.md) 一起做。
4. 拿掉 L93 的錯誤推論，改寫成「並行靠鎖保證」。

## 驗證方式

`apps/api/test/platform-admin.spec.ts` 補一個案例，比照 `test/account-security.spec.ts` L395：

- 兩位 super-admin 用 `Promise.all` 互相降級，一個改角色、一個停用。
- 斷言恰好一個回 `403 LAST_SUPER_ADMIN`。
- 斷言結束後 active 的 super-admin 至少一位。
