# 平台管理者登入失敗被鎖定時會改寫 status，任何知道 email 的人都能把線上的平台管理者踢下線

## 現況

`apps/api/src/modules/platform-admin/platform-admin.repository.ts` 的 `recordFailedLogin()`（L72–99）在失敗次數達到上限時，把 `status` 改成 `locked`（L85）：

```ts
status: sql`CASE WHEN ${reached} THEN 'locked'::platform_admin_status ELSE ${platformAdmins.status} END`,
```

驗證身分的地方都把「不是 active」當成停用：

- `apps/api/src/common/auth/access-token.verifier.ts` 的 `checkIdentity()`（L118）回 `AUTH_ACCOUNT_DISABLED`。每個請求與 WebSocket 訊息都經過它。
- `apps/api/src/modules/platform-admin/platform-admin.service.ts` 的 `findActive()`／`permissionsOf()`（L81–90）：權限變成空集合。
- `apps/api/src/modules/auth/platform-auth.service.ts` 的 `refresh()`（L108–112）：續期回 `AUTH_ACCOUNT_DISABLED`。

`locked_until` 到期之後 `status` 仍是 `locked`，要等下一次成功登入（`platform-admin.service.ts` L63–69）才改回 `active`。既有的 session 不會自己恢復。

重現：

1. 以 client `auth` 開一個登入互動。不必在 apps/platform 的網域上，見 [`platform-path-case-insensitive-bypass.md`](./platform-path-case-insensitive-bypass.md)。
2. 對 `POST /oidc-interaction/:uid/login` 以平台 super-admin 的 email 送 5 次錯誤密碼。
   - `LOGIN_MAX_ATTEMPTS` 預設 5。
   - `auth` 限流是每個「帳號 ＋ IP」每分鐘 10 次，足夠。
3. 最多 30 秒後（使用者快取的 TTL），他的頁面、續期、即時連線全部被拒。之後 15 分鐘（`LOGIN_LOCKOUT_SECONDS`）登不進來。
4. 每 15 分鐘重做一次。

[`backend/04-auth.md`](../architecture/backend/04-auth.md) §3.3 的最後一點寫明這是刻意的：「平台管理介面以 `status = locked` 顯示與解鎖，所以平台管理者的鎖定仍會寫 `status`」。

## 影響

- 同一節也寫了租戶端不改 `status` 的理由：「否則任何知道 email 的人錯 5 次就能把線上的人（包括最後一位 super-admin）踢下線」。這個風險在平台端同樣成立。
- 平台管理者只有幾位，email 常常猜得到。
- 不需要任何帳號就能做到。所有平台管理者都可以被持續鎖在外面；例如事件處理期間，沒有人能停用被入侵的租戶。
- 唯一的出路是請其他平台管理者寄重設密碼的連結（`platform-account.service.ts` 的 `resetPassword()`，L58 起，會順帶解鎖）。但寄連結的人自己也可能被鎖。

## 修正方式

比照租戶：鎖定只寫 `locked_until`，不改 `status`。「顯示與解鎖」這個理由，用租戶端的做法一樣達得到：

1. `recordFailedLogin()` 拿掉 `status` 的 `CASE`。
2. 對外顯示的狀態由 `locked_until` 推出，同 `user.service.ts` 的 `displayStatusOf()`（L68–70）：`PlatformAdminDto.status` 在鎖定期間回 `locked`，管理介面照舊顯示。
3. 解鎖：`PlatformAdminManagementService.update()` 收到 `status: 'active'`、而顯示狀態是 `locked` 時，清掉 `lockedUntil` 與 `failedLoginCount`。
   - 現在以 `admin.status === 'locked'` 判斷（L108–110）。
   - `nextStatus()` 在 `requested === admin.status` 時直接返回，要一起調整。
4. 寫一支平台 migration，把既有的 `status = 'locked'` 改回 `active`，保留 `locked_until`。做法同租戶的 migration `0003`。
5. 更新 [`backend/04-auth.md`](../architecture/backend/04-auth.md) §3.3 的最後一點。

## 驗證方式

在 `apps/api/test/platform-admin.spec.ts` 的「平台管理者」區塊（L162 起）補：

- 錯 5 次密碼之後：
  - 既有的平台 access token 仍可打 `/platform/auth/profile`，refresh 仍成功。
  - 新的登入回 `AUTH_ACCOUNT_LOCKED`。
- 鎖定期間，平台管理者列表的 `status` 是 `locked`。super-admin 以 `PATCH { status: 'active' }` 解鎖之後，可以登入。
