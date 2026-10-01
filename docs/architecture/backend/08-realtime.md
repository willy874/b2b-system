# 後端 08 — 即時推播（Socket.io）

> 狀態：**已實作（Phase 0，單一執行個體）**。決策理由見 [ADR-0008](../../adr/0008-realtime-with-socket-io.md)；
> 前端對應章節見 [`../frontend/11-realtime.md`](../frontend/11-realtime.md)。

## 1. 設計原則

| #   | 原則                     | 落實方式                                                                       |
| --- | ------------------------ | ------------------------------------------------------------------------------ |
| 1   | **推播只是加速**         | 正確性仍由 HTTP ＋ `staleTime` 保證；漏收事件只會變慢，不會錯                  |
| 2   | **預設拒絕**             | 連線必須帶有效 access token；未宣告授權的訊息處理器 → 啟動失敗                 |
| 3   | **推來源變更，不推資料** | payload 只有 `resource / kind / id / refs`，客戶端自己重抓（重抓時照常過 Guard） |
| 4   | **只推給看得到的人**     | 以 `perm:{permissionKey}` room 過濾受眾                                        |
| 5   | **交易後才推**           | 與快取失效同一個時機（[01 §5.2](./01-architecture.md)）；rollback 的變更不會被推出去 |
| 6   | **撤銷即時生效**         | `token_version` 遞增時主動推 `session.revoked` 並斷線                          |

**不在範圍內**：協作編輯、presence（誰在線上）、訊息持久化與重送。
這些之後需要時在同一個 gateway 上擴充，不影響本章的事件。

---

## 2. 目錄與模組相依

業務模組與 WebSocket 之間以 **領域事件匯流排（`DomainEventBus`）** 解耦：
service 只宣告「發生了什麼」，誰要推播、推給誰由訂閱端決定。

```
apps/api/src/
├── core/
│   └── events/                        ★ 領域事件匯流排（全域 module）
│       ├── domain-events.ts           事件名稱 ＋ 事件 → payload 對照表
│       ├── event-bus.ts               DomainEventBus：publish / subscribe / drain
│       └── events.module.ts
├── common/
│   ├── auth/
│   │   ├── access-token.verifier.ts   ★ 從 JwtAuthGuard 抽出：驗簽 → userCache → status / ver 檢查
│   │   └── access-token.module.ts     @Global：JwtAuthGuard（AppModule）與 gateway 都注入 verifier
│   ├── types/
│   │   └── authenticated-socket.ts    `WsClient` ＋ socket.data 的身分：guard 不必 import modules，也不綁 Socket.io 的型別
│   └── guards/
│       ├── jwt-auth.guard.ts          改用 AccessTokenVerifier
│       ├── ws-auth.guard.ts           ★ 訊息處理器用：重驗 socket 上的使用者仍有效
│       └── permissions.guard.ts       支援 ctx.getType() === 'ws'
└── modules/
    └── realtime/
        ├── realtime.module.ts
        ├── realtime.gateway.ts        【傳輸層】連線驗證、加入 room、session.renew、channel.relay
        ├── realtime.publisher.ts      【傳輸層】RealtimePublisher（抽象）＋ Socket.io 實作：emit / 連線數 / 換 room / 斷線
        ├── realtime.expiry.ts         【傳輸層】access token 到期斷線的計時器
        ├── realtime.listener.ts       ★ 訂閱領域事件 → 同步 room / 推播 / 撤銷（只經 RealtimePublisher）
        ├── realtime.audience.ts       來源 → room 的對照、同步使用者的 perm room（只經 RealtimePublisher）
        ├── realtime.rate-limit.ts     §11 的 Origin、handshake、訊息速率、連線數限制
        ├── realtime.constants.ts      REALTIME_LIMITS（可由測試覆寫）
        ├── realtime.types.ts          【傳輸層】RealtimeServer / RealtimeSocket（套上合約泛型）；唯一 import socket.io 的檔案
        └── realtime.rooms.ts          room 名稱（userRoom / permRoom），不以模板散落各處

packages/realtime/                     ★ 事件合約（前後端共用，見 §9）
```

```
UserModule / RoleModule / AuthModule ──▶ core/events（DomainEventBus）◀── RealtimeModule
                                                                          └──▶ PermissionModule
```

- **業務模組不 import `RealtimeModule`**。拿掉 realtime，業務模組照樣編譯、照樣運作，只是沒有推播。
- `RealtimeModule` 依賴 `PermissionModule`（解析權限集合 → perm room）與 bus；沒有模組依賴它。
- Gateway 放在 `modules/` 而不是 `core/`：它需要 `PermissionService` 來決定 room，而 `core/` 不認識任何 module。
- Bus 放在 `core/`：它只認得事件的形狀，不認得任何發佈者或訂閱者。

### 2.1 傳輸層的邊界

Socket.io 只是傳輸層；受眾判斷與推播時機不認識它。標了【傳輸層】的檔案之外，一律經由抽象：

| 誰                         | 經由                   | 可以做的事                                                        |
| -------------------------- | ---------------------- | ----------------------------------------------------------------- |
| `RealtimeListener`、`RealtimeAudience` | `RealtimePublisher` | `emit(rooms, event, …)`、`countConnections(room)`、`moveRooms(room, leave, join)`、`disconnect(room)` |
| `common/guards/*`          | `WsClient`（`common/types`） | 讀 `socket.data` 的身分、`disconnect(true)`                   |

- `RealtimePublisher` 是 abstract class（同時當 DI token），實作是 `SocketIoRealtimePublisher`。
  伺服器物件由 gateway 在 `afterInit` 以 `attach()` 交進去；反過來讓 publisher 注入 gateway 會形成
  gateway → audience → publisher → gateway 的循環。交進去之前所有操作都是空操作。
- `emit` 在 room 為空時不推：Socket.io 的 `to([])` 會廣播給 **所有** 連線。
- 🔒 `transport-boundary.spec.ts`：只有 `realtime.types.ts` import `socket.io`；只有 gateway、publisher、expiry
  使用 `realtime.types`。換掉 Socket.io 時，要改的就是這四個檔案。
- `RealtimePublisher` 只在 `modules/realtime` 內使用；業務模組仍然只發佈領域事件（[ADR-0008](../../adr/0008-realtime-with-socket-io.md) 理由 7）。

---

## 3. 連線

### 3.1 路徑與傳輸

```ts
@WebSocketGateway({
  path: '/socket.io',          // 瀏覽器看到的是 /api/socket.io；proxy 去掉 /api（同 HTTP）
  transports: ['websocket'],   // 不開 long-polling：免 sticky session，也少一條吃 cookie 的 HTTP 路徑
  serveClient: false,
  cors: false,                 // 同源；另以 allowRequest 檢查 Origin（§11）
})
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {}
```

### 3.2 Handshake 驗證

驗證寫在 `afterInit` 註冊的 `io.use()` middleware，**驗證失敗就不建立連線**，不會有「先連上再踢掉」的空窗：

```ts
afterInit(io: RealtimeServer) {
  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token;
    const result = await this.verifier.verify(typeof token === 'string' ? token : undefined);
    if (!result.ok) return next(connectError(result.code)); // AUTH_TOKEN_INVALID / AUTH_TOKEN_STALE / AUTH_ACCOUNT_DISABLED
    socket.data.userId = result.user.id;
    socket.data.tokenVersion = result.payload.ver;
    socket.data.expiresAt = result.payload.exp * 1000;
    next();
  });
}

function connectError(code: ErrorCode): Error {
  // 客戶端在 connect_error 的 err.data.code 拿到，和 HTTP 的錯誤碼同一套
  return Object.assign(new Error(code), { data: { code } });
}
```

- `AccessTokenVerifier` 與 `JwtAuthGuard` **共用同一段邏輯**：驗簽 → `UserCacheService` → `deletedAt` / `status` / `token_version`。
  不在 gateway 重寫一次，避免兩邊的判定規則分歧。
- **不用 cookie 驗證。** refresh cookie 的 Path 是 `/api/auth`，本來就不會送到 `/api/socket.io`；
  用 token 也讓跨站 WebSocket 劫持（CSWSH）無從利用瀏覽器自動帶的憑證。
- Token 放在 `handshake.auth`，**不放 query string**（會進 proxy 與存取日誌）。

### 3.3 連線成功之後

```ts
async handleConnection(socket: RealtimeSocket) {
  this.expiry.schedule(socket);                                 // §3.4
  // 先解析完權限（可能要查 DB）再一次加入所有 room：看得到連線在 user room 裡，就代表 perm room 也已就緒
  const permRooms = await this.audience.roomsFor(socket.data.userId); // 依權限集合（含依賴樹閉包）的 perm:<key>
  await socket.join([userRoom(socket.data.userId), tenantRoom(tenantId), ...permRooms]);
}

handleDisconnect(socket: RealtimeSocket) {
  this.expiry.cancel(socket);
}
```

### 3.4 Access token 到期與續期

Access token 只有 5 分鐘，連線會比它活得久。規則：**連線的授權期限 = 最後一次驗過的 token 的 `exp`**。

| 時機                       | 伺服器                                                                          |
| -------------------------- | ------------------------------------------------------------------------------- |
| 客戶端送 `session.renew`   | 以同一個 verifier 驗新 token；**`sub` 必須相同**（不能在連線上換人）；更新 `expiresAt` 並重設計時器；ack `{ ok: true }` 或 `{ ok: false, code }` |
| 到了 `expiresAt` 還沒續期  | 推 `session.expired`，接著 `socket.disconnect(true)`                            |

客戶端在 `SessionStore` 續期成功時送 `session.renew`；閒置分頁收到 `session.expired` 時重新連線，
handshake 會先透過 `ensureAccessToken()` 換一張新 token（[前端 11 §3](../frontend/11-realtime.md)）。

### 3.5 撤銷

`token_version` 遞增（停用、刪除、改密碼、強制登出所有裝置）的 service，在交易後呼叫：

```ts
this.events.publish(DomainEvent.SESSIONS_REVOKED, {
  userIds: [userId],
  reason: SessionRevokedReason.TOKEN_STALE,
});
// realtime.listener → io.to(userRoom(id)).emit('session.revoked', { reason })
//                   → io.in(userRoom(id)).disconnectSockets(true)
```

單一登出（[ADR-0019](../../adr/0019-sso-identity-platform.md) D5）改帶 `idpSessionUids`：只撤銷 `sid:{uid}` room 的連線，
同一個人的其他裝置不受影響；`reason` 是 `SessionRevokedReason.SIGNED_OUT`（`AUTH_REFRESH_REVOKED`）。
平台管理者停用或刪除租戶時帶 `tenantIds`：撤銷 `t:{tenantId}` room 的所有連線，`reason` 是 `TENANT_UNAVAILABLE`
（[ADR-0020](../../adr/0020-physical-tenant-isolation.md) D13；這個事件在平台的請求裡發佈，沒有租戶脈絡）。

之前被停用的人要等到「下一次 HTTP 請求」才會被擋下；現在是即時的。
單一裝置的登出不遞增 `token_version`，由該分頁自己斷線（前端 `SessionStore` 的 `ended`）。

---

## 4. 訊息處理器的授權

`JwtAuthGuard` 的 `if (ctx.getType() !== 'http') return true` 代表 **HTTP 的守門員對 WebSocket 不生效**。
WebSocket 另有三道防線：

1. **連線 middleware**（§3.2）：沒有有效 token 就連不上。
2. **`WsAuthGuard`**：每則客戶端訊息都以 `socket.data` 重驗使用者
   （走 `UserCacheService`，30 秒 TTL），停用、`token_version` 不符或已超過 `expiresAt` 就拒絕並斷線。
3. **`PermissionsGuard` 支援 `ws`**：從 `socket.data.userId` 解析權限集合，其餘判定與 HTTP 相同；拒絕時拋帶 `code` 的 `WsException`。

> **Nest 12 起 `APP_GUARD` / `APP_INTERCEPTOR`（與 `APP_PIPE`）也套用到 WebSocket gateway**（`APP_FILTER` 仍不套用）。
> 所以 `WsAuthGuard` 與 `PermissionsGuard` 都是全域 guard，依 `app.module.ts` 的順序
> `RateLimitGuard → JwtAuthGuard → WsAuthGuard → FeatureGuard → PermissionsGuard` 執行，gateway 不再 `@UseGuards`
> （class 層的 guard 排在全域之後，會讓 `PermissionsGuard` 先於 `WsAuthGuard`）。
> HTTP 專用的 `RateLimitGuard`、`JwtAuthGuard`、`FeatureGuard` 與 `TransformInterceptor` 遇到 `ws` 直接放行：
> ack 不包 `{ data }`，限流由 §11 自己做。

---

## 5. 路由稽核延伸到 gateway

`common/route-audit.ts` 目前只掃 Express 路由。改成同時掃所有 gateway 的 `@SubscribeMessage`：

| 宣告                         | WebSocket 上的意義                             |
| ---------------------------- | ---------------------------------------------- |
| `@Authenticated()`           | 已登入即可（連線本身已驗證）                   |
| `@RequirePermissions(...)`   | 需要特定權限                                   |
| `@Public()`                  | **不允許**——連線一定已驗證，出現即視為寫錯     |
| 都沒有                       | **程序啟動失敗**，與 HTTP 路由同樣預設拒絕    |

---

## 6. Room 與受眾

| Room                   | 誰在裡面                                   | 名稱來源                     |
| ---------------------- | ------------------------------------------ | ---------------------------- |
| `t:{tenantId}:user:{userId}` | 該使用者的所有連線（所有裝置、所有分頁）   | `userRoom(id)`（租戶取自目前的租戶脈絡） |
| `t:{tenantId}`         | 這個租戶的所有連線（停用、刪除租戶時一次斷掉；租戶啟用的 feature 變更時推 `tenantFeature`） | `tenantRoom(tenantId)`（ADR-0020 D13、ADR-0021 D8） |
| `t:{tenantId}:perm:{permissionKey}` | 目前租戶裡持有該權限的使用者的連線 | `permRoom(key)`（例 `t:…:perm:role:read`；租戶取自目前的租戶脈絡） |
| `sid:{idpSessionUid}`  | 同一個 IdP session 的連線（經 SSO 登入、token 帶 `sid` 時才加入） | `idpSessionRoom(uid)`（ADR-0019 D5） |

super-admin 加入自己租戶的所有 perm room。

- **perm room 帶租戶**（[ADR-0020](../../adr/0020-physical-tenant-isolation.md) D17）：一個程序服務所有租戶，
  權限鍵的名稱各租戶都一樣，不帶租戶的話 A 租戶的變更會推給 B 租戶持有同一權限的人。
  使用者的 room 也帶租戶：使用者 id 只在自己的租戶 DB 裡唯一（從備份還原或複製出來的租戶會有相同的 id）。
  `sid:` 用的是 IdP 全域唯一的 uid，不必帶租戶。
- **連線屬於一個租戶**：handshake 時依網域決定（找不到回 `connect_error` 的 `TENANT_NOT_FOUND`），
  之後這條連線上的每則訊息都在該租戶的脈絡裡處理（`socket.use` 包一層 `runInTenantContext`）。

### 6.1 來源 → 受眾

推播的受眾是「會因這筆變更而需要重抓的人」。對照表寫在 `realtime.audience.ts`，與前端
`apis/resources.ts` 的依賴圖對應：

| 來源（`resource`） | perm room                                  | user room                          | 為什麼                                               |
| ------------------ | ------------------------------------------ | ---------------------------------- | ---------------------------------------------------- |
| `user`             | `user:read`、`role:read`                   | 被改的那個人                       | 角色的持有者清單嵌入使用者名稱與狀態；本人的 profile |
| `userRole`         | `user:read`、`role:read`                   | 被指派／移除的那個人               | 使用者嵌入角色摘要、角色的 userCount；本人的權限      |
| `role`             | `role:read`、`user:read`（僅 update/delete）| 持有該角色的所有人（update/delete）| 使用者嵌入角色名稱；持有者的權限可能改變              |
| `rolePermission`   | `role:read`                                | 持有該角色的所有人                 | 權限數與清單；持有者的有效權限                        |
| `userCredential`   | —                                          | —                                  | 沒有任何畫面顯示憑證                                  |
| `approval`         | `approval:read`                            | —                                  | 審批列表；匿名申請人（註冊）沒有連線，不必通知本人    |
| `file`             | `file:read`、`file:access`                 | —                                  | 檔案列表與詳情（`pending` 不推，完成上傳才算建立）。`file:access` 的人只看得到被授權的資料夾：收到看不到的變更只會多重抓一次 |
| `fileFolder`       | `file:read`、`file:access`                 | —                                  | 資料夾樹、麵包屑、主區塊的資料夾；資料夾授權變更也以 `fileFolder update` 推出（能力旗標跟著變） |
| `setting`          | `system:read`                              | —                                  | 系統設定頁；公開設定（登入頁、預設時區）下次載入時生效，不推給所有人（[`12-settings.md`](./12-settings.md) §4） |
| `tenantFeature`    | —（不經這張表）                            | —                                  | 平台層的變更：由 `tenant.featuresChanged` 直接推給 `t:{tenantId}`（每個人都要重新取得 profile，含 `features` 與 `flags`），見 §7.1。表裡的列是空的，只為了讓 `Record<ChangeSource, …>` 完整 |
| `notification`     | —                                          | 收件人（`affectedUserIds`；`id` 是通知 id，不是使用者 id） | 站內通知是個人的東西，只推給收件人自己的所有連線（[ADR-0026](../../adr/0026-notification-center.md) D8，[`15-notification.md`](./15-notification.md) §7）；不寫稽核，所以 **不** 加 `auditLog:read` |
| `notificationPolicy` | `system:read`                            | —                                  | 事件管理頁（[`16-notification-event.md`](./16-notification-event.md) §4；與系統設定同一群讀者） |
| `serviceAccount`   | `serviceAccount:read`                      | —                                  | 服務帳號的列表與詳情（[ADR-0027](../../adr/0027-api-tokens-external-api.md) T4）；服務帳號沒有連線，不推本人 |
| `apiToken`         | `serviceAccount:read`、`user:update`       | 個人 token 的擁有者（`affectedUserIds`） | 服務帳號的 token（`refs.serviceAccount`）、使用者詳情頁的 token、自己的個人 token |
| `notificationPreference` | —                                    | 本人（`affectedUserIds`）          | 自己的通知設定（[`16-notification-event.md`](./16-notification-event.md) §5）；不寫稽核，所以 **不** 加 `auditLog:read` |
| 任何來源（`notification`、`notificationPreference` 除外） | `auditLog:read`                 | —                                  | 每次寫入都會新增一筆稽核（`derivesFromAnyChange`）；規則上標 `recordsAudit: false` 的來源不算 |

- `io.to([...rooms]).emit()` 會對多個 room 的聯集 **去重**，同一條連線只收到一次。
- 「持有該角色的所有人」由 service 查出（刪除角色時在軟刪除之前、交易內查出；持有者邊保留，ADR-0025 D2），
  只用來讓他們的畫面重抓；權限快取的失效與 room 的同步不依賴這份清單（[05 §5.1](./05-rbac.md)）。
- Payload 只有 id，不含名稱或內容；即使受眾稍微放寬也不會外洩資料。

### 6.2 權限變更時同步 room

使用者的權限集合改變後，他的連線必須換 room，否則會繼續收到（或收不到）不該收的事件。
關係圖的失效以整個租戶為單位（[05 §5.1](./05-rbac.md)），所以收到 `permissions.changed` 時，listener 對
**這個租戶在本機的所有連線**（`RealtimePublisher.connectedUserIds(tenantRoom(tenantId))`）重算，不看事件帶的名單：

```ts
async refreshAudience(userIds: readonly string[]) {
  const connected = [...new Set(userIds)].filter((id) => this.publisher.countConnections(userRoom(id)));
  for (const batch of chunks(connected, 200)) {
    const sets = await this.permissionService.getPermissionSets(batch); // 每批兩條 SQL（主體閉包 CTE ＋ 租戶節點上的邊）
    for (const id of batch) this.publisher.moveRooms(userRoom(id), allPermRooms(), permRoomsFor(sets.get(id)));
  }
}
```

一個租戶可能有上千條連線：權限以 `PermissionService.getPermissionSets` **批次** 解析（快取命中的不查；其餘每批
兩條查詢：多人一次的主體閉包 CTE、這些主體在租戶節點上的邊，[`05-rbac.md`](./05-rbac.md) §4），不是每人各查一次。
權限集合含依賴樹閉包，所以持有 `file:delete` 的人也在 `perm:file:read` 的 room 裡。檔案模組補建個人資料夾前篩選「能進檔案管理器的人」也用同一個批次方法。

`moveRooms` 的 Socket.io 實作是 `io.in(room).socketsLeave(…)` / `socketsJoin(…)`，經由 adapter 作用在所有節點上的連線（§10）。

目前的實作會 **略過本節點沒有連線的使用者**（不必為他們查 DB）。裝上跨節點 adapter 時要拿掉這個捷徑，
否則其他節點上的連線不會換 room（程式碼註解已標記）。

---

## 7. 推播：領域事件匯流排

### 7.1 事件

| 事件（`DomainEvent`）  | payload                                                   | 由誰發佈                         | `realtime.listener` 的動作                  |
| ---------------------- | --------------------------------------------------------- | -------------------------------- | ------------------------------------------- |
| `permissions.changed`  | `{ userIds? }`                                            | `AuthzRevision`：本機的權限寫入提交後，或收到其他程序的 revision 廣播後（在那個租戶的脈絡）| 重算這個租戶在本機所有連線的 perm room（§6.2）。`userIds` 只在發起寫入的程序上有、不是完整清單，給檔案模組補建個人資料夾用 |
| `resource.changed`     | `{ changes: ResourceChangeWire[], affectedUserIds? }`     | 所有會改變畫面資料的寫入         | 依 §6.1 算出 room，推 `resource.changed`    |
| `sessions.revoked`     | `{ userIds, reason }`                                     | 遞增 `token_version` 的寫入      | 推 `session.revoked` 並斷線（§3.5）         |
| `tenant.featuresChanged` | `{ tenantId }`                                          | 平台管理者改了租戶的 `features` 或 feature flag 的租戶覆寫（`PlatformTenantService.update`，`TenantDirectory.invalidate()` 之後）；改了 flag 的全平台覆寫時對每個 `active` 租戶各發一次（`PlatformFeatureFlagService.update`） | 對 `t:{tenantId}` 推 `resource.changed`（`{ resource: 'tenantFeature', kind: 'update' }`，沒有 `origin`）；前端重新取得 profile（[ADR-0021](../../adr/0021-runtime-feature-activation.md) D8） |

事件描述的是 **領域上發生了什麼**，不是「要推給誰」；受眾的判斷只在 listener 裡。
之後新增的訂閱者（例：寄通知信、webhook）不需要動到發佈端。

### 7.2 `DomainEventBus` 的語意

```ts
export interface DomainEventBus {
  /** 交易提交後呼叫。不拋錯、不等待 handler（fire-and-forget）。 */
  publish<K extends DomainEvent>(type: K, payload: DomainEventPayloads[K]): void;
  subscribe<K extends DomainEvent>(
    type: K,
    handler: DomainEventHandler<K>,
    options?: { remote?: boolean }, // 也收其他程序轉送來的（§7.6）
  ): () => void;
  /** 其他程序轉送來的事件（`DomainEventRelay`，§7.6）：只交給 `{ remote: true }` 的訂閱者。 */
  deliverRemote<K extends DomainEvent>(type: K, payload: DomainEventPayloads[K], meta: DomainEventMeta): void;
  /** 測試用：等所有已發佈的事件處理完。 */
  drain(): Promise<void>;
}

type DomainEventHandler<K> = (payload: DomainEventPayloads[K], meta: DomainEventMeta) => Promise<void> | void;

interface DomainEventMeta {
  occurredAt: Date;
  clientId?: string;   // x-client-id（§7.5）
  requestId?: string;
  remote?: boolean;    // 由其他程序轉送來的（§7.6）
}
```

| 語意                         | 為什麼                                                                                  |
| ---------------------------- | --------------------------------------------------------------------------------------- |
| **`meta` 在 publish 當下擷取** | handler 非同步執行時請求 context 可能已結束；`origin` 必須是發起請求的那個分頁          |
| **同一租戶內依序處理**（每個租戶一條 queue，逐一 await） | 同一次操作先發 `permissions.changed` 再發 `resource.changed`：room 一定先同步完才推播 |
| **租戶之間互不阻塞** | queue 以發佈當下的租戶分開：一個租戶改了上千人持有的角色，其他租戶的推播不必等它（沒有租戶脈絡的平台事件另成一條） |
| **`sessions.revoked` 走優先通道** | 每個租戶另有一條優先 queue：踢線不排在同租戶的大量 room 同步之後；它與其他事件沒有先後依賴（session 作廢由 `token_version` 保證） |
| **handler 錯誤隔離**         | 記錄後吞掉；一個訂閱者壞掉不影響其他訂閱者，也不影響已經成功的寫入                      |
| **不阻塞 HTTP 回應**         | 推播只是加速（原則 1）                                                                  |
| **行程內、不持久化**         | 行程在事件處理前結束，事件就遺失——客戶端重連時會整批重新驗證；推播類事件另經 §7.6 轉送給其他程序，同樣不保證送達 |

### 7.3 在 service 裡的位置

與快取失效並排，**都在交易之後**：

```ts
async updatePermissions(roleId: string, dto: UpdatePermissionsDto, actor: AuthUser) {
  // … 反提權、讀 before …

  await withTransaction(this.db, async (tx) => {
    // … 寫入 ＋ 稽核（交易內）
  });

  // ★ 交易之後：整個租戶的權限快取失效、發 permissions.changed、廣播給其他程序（05 §5.1）。
  // 持有者不是失效的依據：給剛取得檔案權限的人補建個人資料夾、讓他們的畫面重抓
  const holders = await this.permissionService.findUserIdsByRole(roleId);
  await this.permissionService.permissionsChanged(holders);
  this.events.publish(DomainEvent.RESOURCE_CHANGED, {
    changes: [{ resource: ChangeSource.ROLE_PERMISSION, kind: ChangeKind.UPDATE, id: roleId }],
    affectedUserIds: holders,
  });
}
```

| 規則                                         | 理由                                                                               |
| -------------------------------------------- | ---------------------------------------------------------------------------------- |
| **事件在交易後發佈**                         | 交易 rollback 時不會推出一個不存在的變更；客戶端重抓時資料一定已提交              |
| **權限快取失效不走 bus**                     | 它決定授權是否正確，必須同步、確定地發生（`permissionsChanged()` 先失效、再由 `AuthzRevision` 發 `permissions.changed`）；bus 只負責「晚一點發生也沒關係」的副作用 |
| **先失效快取、再發佈**                       | 客戶端收到後立刻重抓；若快取還沒失效，會拿到舊權限並快取在前端                    |
| **`changes` 與前端 mutation 宣告的來源一致** | 前端 `invalidateResources()` 宣告了什麼，伺服器就發佈什麼（同一張依賴圖）          |
| **`affectedUserIds` 只給推播**               | 失效與 room 同步以整個租戶為單位，不依賴 service 算出的持有者清單                  |

各寫入發佈的事件（實作時的對照；與前端 mutation 宣告的來源一致，有些更精確）：

| 操作                         | `resource.changed`                                   | 另外發佈                                                  |
| ---------------------------- | ---------------------------------------------------- | --------------------------------------------------------- |
| 角色建立／複製               | `role create`（帶 `id`）                             | —                                                         |
| 角色更新                     | `role update`，持有者                                | —                                                         |
| 角色權限增減                 | `rolePermission update`，持有者                      | 先發 `permissions.changed`                                |
| 角色刪除                     | `role delete`，原本的持有者（軟刪除前查出）          | 先發 `permissions.changed`                                |
| 角色還原                     | `role create` ＋ 每位持有者一筆 `userRole update`（`refs.role`），持有者 | 先發 `permissions.changed`（`userIds` = 持有者） |
| 角色永久刪除（`trash.purge`）| `role delete`（每個一筆）                            | 先發 `permissions.changed`                                |
| 使用者建立                   | `user create`，`refs.role`                           | 帶角色時先發 `permissions.changed`（`userIds` = 本人）    |
| 使用者更新／解鎖             | `user update`，`refs.role`                           | 停用時 `sessions.revoked`（`AUTH_ACCOUNT_DISABLED`）      |
| 使用者刪除                   | `user delete`，`refs.role`（刪除前查出）             | `sessions.revoked`（`AUTH_TOKEN_INVALID`）                |
| 指派角色                     | `userRole update`，`refs.role` = 新舊角色聯集        | 先發 `permissions.changed`                                |
| 寄重設密碼信                 | `userCredential update`                              | —                                                         |
| 修改個人資料／啟用／登入鎖定 | `user update`                                        | —                                                         |
| 改密碼／以重設信改密碼       | `userCredential update`                              | `sessions.revoked`（`AUTH_TOKEN_STALE`）                  |
| 送出註冊申請                 | `approval create`                                    | —                                                         |
| 核准審批                     | `approval update`；`user.register` 另發 `user create`，`refs.role` | —                                           |
| 駁回審批                     | `approval update`                                    | —                                                         |
| 檔案上傳完成／改名／刪除     | `file create` / `file update` / `file delete`，`refs.fileFolder` = 所在的資料夾（根目錄是 `root`）；圖片的 create 等變體最多 3 秒，與變體完成合併成一次 | —                                                         |
| 建立／改名資料夾             | `fileFolder create` / `fileFolder update`            | —                                                         |
| 移動檔案與資料夾             | `fileFolder update`（`id='*'`）、`file update`（`id='*'`） | —                                                   |
| 遞迴刪除資料夾               | `fileFolder delete`；有檔案一起刪除時另發 `file delete`（`id='*'`） | —                                         |
| 資料夾授權變更、中斷繼承     | `fileFolder update`（id 是該資料夾）                 | —                                                         |
| 還原檔案                     | `file create`，`refs.fileFolder` = 所在的資料夾      | —                                                         |
| 還原資料夾                   | `fileFolder create`；有檔案一起還原時另發 `file create`（`id='*'`） | —                                          |
| 檔案、資料夾永久刪除（`trash.purge`） | `file delete` / `fileFolder delete`（每個一筆；資料夾只有每批的根） | —                                   |
| 修改或還原系統設定           | `setting update`（每個 key 一筆，id 是設定的 key）   | —                                                         |
| 寫入站內通知（`NotificationService.notify()`） | 每位收件人各一則 `notification create`（id 是他自己的通知 id，一次超過 100 則時不帶 id），`affectedUserIds` = 那位收件人；由 `afterCommit` 在交易提交時就發出，早於同一個操作在交易後才發的事件 | —                                        |
| 通知標為已讀／全部已讀       | `notification update`（單則帶 id；全部已讀不帶），`affectedUserIds` = 自己 | —                                    |
| 開關事件通知（`PATCH /notification-events`） | `notificationPolicy update`（每個改到的事件一筆，id 是事件類型） | —                                    |
| 修改自己的通知設定（`PATCH /me/notification-preferences`） | `notificationPreference update`（每個改到的事件一筆，id 是事件類型），`affectedUserIds` = 自己 | —                                    |
| 服務帳號建立／修改／刪除／指派角色 | `serviceAccount create` / `update` / `delete`，加上持有者變動的角色各一筆 `role update` | —                                       |
| 建立／撤銷 API token         | `apiToken create` / `apiToken update`；服務帳號的帶 `refs.serviceAccount`，個人的 `affectedUserIds` = 擁有者 | —           |
| 平台管理者改了租戶啟用的 feature | 不發 `resource.changed`；發 `tenant.featuresChanged`（平台的請求沒有租戶脈絡，room 以 `tenantId` 組） | —                                  |

登入失敗被鎖定 **不** 遞增 `token_version`，因此不撤銷既有連線：被鎖的人最遲在 access token 到期（§3.4）
或下一則客戶端訊息（`WsAuthGuard`）時斷線。

### 7.4 升級路徑

Bus 的介面不變，實作可以替換：

| 階段                     | 實作                                                                                   |
| ------------------------ | -------------------------------------------------------------------------------------- |
| Phase 0（單一執行個體）  | 行程內 queue                                                                           |
| 多個程序（已做）         | bus 仍在行程內；推播類事件經平台 DB 的 `NOTIFY` 轉送，每個程序推給自己的連線（§7.6）       |
| 需要保證送達（通知信等） | Transactional outbox：事件在交易 **內** 寫進 `domain_events` 表，由背景工作讀出後分派   |

### 7.5 `origin`：略過發起的分頁

發起寫入的分頁在 mutation 成功時已經自己失效過了；伺服器推回來的同一筆再失效一次，會多抓一次。

- 前端每個請求帶 `x-client-id`（分頁的 instance id）。
- `RequestIdMiddleware` 旁邊加一段把它存進請求 context（`core/http`），格式驗證：長度 ≤ 64、僅 `[A-Za-z0-9:-]`，不合格就忽略。
- `DomainEventBus.publish` 在發佈當下把它放進 `meta.clientId`，listener 推播時放進 `origin`；客戶端比對到自己就略過。

這個 header 只用來去重，**不做任何授權判斷**。

### 7.6 跨程序轉送（`DomainEventRelay`）

api 之外還會有別的程序寫入資料：對外 API（[ADR-0027](../../adr/0027-api-tokens-external-api.md) D9）、之後拆出的 worker、
多個 api 執行個體。bus 在行程內，那些程序發佈的事件，連在 api 上的使用者原本收不到。

`core/events/event-relay.ts` 把 **推播類** 事件經平台 DB 的 `NOTIFY`（頻道 `domain_event`，`core/broadcast`）送給其他程序：

| 事件 | 轉送 | 理由 |
| --- | --- | --- |
| `resource.changed`、`sessions.revoked`、`tenant.featuresChanged` | ✅ | 推播是「每個程序對自己的連線做一次」 |
| `permissions.changed` | ❌ | `AuthzRevision` 已經以 revision 廣播，收到的程序重新發佈（[05 §5.1](./05-rbac.md)） |
| `tenant.activated` | ❌ | 訂閱者（補系統資料夾）寫資料庫，整個系統做一次就夠 |

- **只到願意收的訂閱者**：收到的程序在發佈端的租戶脈絡裡（`Tenancy.run`）以 `deliverRemote` 交給本機的 bus，
  只有以 `{ remote: true }` 訂閱的 handler 收得到（目前只有 `realtime.listener`）。寫資料庫、撤銷 OIDC session 這類
  「整個系統做一次」的訂閱者維持預設，不會在每個程序重複執行。
- **不會繞圈**：轉送只訂閱本機發佈的事件；`channel()` 的信封帶送出的程序，自己送的不會收回來。
- **`meta` 跟著過去**：`clientId`（`origin`）、`requestId`、`occurredAt` 照發佈端的；`meta.remote` 標成 `true`。
- **放不進一則 `NOTIFY`（8000 位元組）**：資源變更拿掉個別的 `id`／`refs`，退化成「這個來源全部失效」，受影響的人每 150 個一則；
  撤銷連線的名單每 150 個一則。
- **租戶進不去**（停用、維護中）就略過：它的連線已經或即將被斷掉。格式不對的訊息（不同版本並存）略過。
- 不保證送達，與 bus 同一個等級；漏掉時前端在下一次重新連線、或下一次自己抓資料時看到新資料。

---

## 8. 跨裝置中繼：`channel.relay`

讓前端 `shared/channel` 的頻道可以跨裝置（例：偏好設定）。伺服器不理解 payload，只轉送：

```ts
@Authenticated()
@SubscribeMessage(ClientEvent.CHANNEL_RELAY)
relay(@ConnectedSocket() socket: RealtimeSocket, @MessageBody() body: unknown) {
  const envelope = channelEnvelopeSchema.safeParse(body);
  if (!envelope.success || !isRelayable(envelope.data.channel)) return;
  socket.to(userRoom(socket.data.userId)).emit(ServerEvent.CHANNEL_RELAY, envelope.data);
}
```

| 限制                                     | 理由                                                             |
| ---------------------------------------- | ---------------------------------------------------------------- |
| **只轉給同一個使用者的其他連線**         | 不能變成任意廣播的通道                                           |
| 頻道名稱白名單（`ge:store:preference:` 前綴） | 帶 token 的 `session:*` 頻道永遠不該離開本機                |
| 外框序列化後 ≤ 4 KB                      | 偏好設定用不到更大；擋掉濫用                                     |
| 計入 §11 的訊息速率                      | 同上                                                             |

---

## 9. 事件合約：`packages/realtime`

事件名稱、payload 的 zod schema 與 Socket.io 的泛型型別放在新的 workspace package，前後端共用。
OpenAPI 描述不了 Socket 事件，所以不放進 `api-sdk`。

```ts
export const ServerEvent = {
  RESOURCE_CHANGED: 'resource.changed',
  SESSION_EXPIRED: 'session.expired',
  SESSION_REVOKED: 'session.revoked',
  CHANNEL_RELAY: 'channel.relay',
} as const;

export const ClientEvent = {
  SESSION_RENEW: 'session.renew',
  CHANNEL_RELAY: 'channel.relay',
} as const;

/** 伺服器會推的來源；前端的 Resource 必須是它的超集（PROFILE 等只存在於前端）。 */
export const ChangeSource = {
  USER: 'user',
  ROLE: 'role',
  USER_ROLE: 'userRole',
  ROLE_PERMISSION: 'rolePermission',
  USER_CREDENTIAL: 'userCredential',
  APPROVAL: 'approval',
  FILE: 'file',
  FILE_FOLDER: 'fileFolder',
  SETTING: 'setting',
  /** 平台管理者變更了租戶啟用的 feature；前端據此重新取得 profile（ADR-0021 D8）。 */
  TENANT_FEATURE: 'tenantFeature',
  /** 站內通知（id = 通知 id）；只推給收件人（ADR-0026 D8）。 */
  NOTIFICATION: 'notification',
  /** 事件管理的租戶政策（id = 事件類型；ADR-0028 D9）。 */
  NOTIFICATION_POLICY: 'notificationPolicy',
  /** 自己的通知設定（id = 事件類型）；只推給本人（ADR-0028 D15）。 */
  NOTIFICATION_PREFERENCE: 'notificationPreference',
  /** 服務帳號（ADR-0027 T4）。 */
  SERVICE_ACCOUNT: 'serviceAccount',
  /** API token；服務帳號的帶 `refs.serviceAccount`（ADR-0027 T4）。 */
  API_TOKEN: 'apiToken',
} as const;

export const resourceChangedSchema = z.object({
  changes: z.array(resourceChangeWireSchema).max(100),
  origin: z.string().max(64).optional(),
});

export interface ServerToClientEvents {
  'resource.changed': (payload: ResourceChanged) => void;
  'session.expired': () => void;
  'session.revoked': (payload: { reason: SessionRevokedReason }) => void;
  'channel.relay': (envelope: ChannelEnvelopeWire) => void;
}

export interface ClientToServerEvents {
  'session.renew': (payload: { token: string }, ack: (result: RenewResult) => void) => void;
  'channel.relay': (envelope: ChannelEnvelopeWire) => void;
}
```

- **兩端都在執行期驗證**：伺服器驗客戶端送來的，客戶端驗伺服器推來的（版本並存時不會壞掉，只會略過）。
- 新增事件＝在這裡加名稱與 schema →（需要時）`core/events` 加領域事件 → `realtime.listener` 或 gateway → 前端 `core/realtime` 的處理，**同一批**修改。
- 依賴規則：`packages/realtime` 只依賴 `zod`，不依賴任何 workspace package，不使用 DOM / Node 專屬 API
  （[`conventions/07`](../../conventions/07-layer-dependencies.md) §1）。

---

## 10. 部署與擴展

### 10.1 本機

Vite proxy 的 `/api` 規則加上 `ws: true`；既有的 rewrite 會把 `/api/socket.io` 轉成 `/socket.io`。

### 10.2 Production

```nginx
location /api/socket.io/ {
  proxy_pass http://api/socket.io/;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
  proxy_set_header Host $host;
  proxy_read_timeout 60s;   # 大於 pingInterval（25s）＋ pingTimeout（20s）
}
```

### 10.3 多執行個體

| 需求               | 作法                                                                                       |
| ------------------ | ------------------------------------------------------------------------------------------ |
| Sticky session     | **不需要**：只用 websocket 傳輸，連線建立後就固定在同一個節點                               |
| 伺服器端推播       | **已做**：每個節點收到其他節點轉送的事件後推給自己的連線（§7.6）。因此 **不要** 再裝 adapter 的跨節點 emit，否則同一則推播會送兩次 |
| 跨裝置中繼（§8）   | 仍只在本節點：同一個人連在不同節點的分頁收不到彼此的 `channel.relay`；要跨節點時再決定用 adapter 或另一條轉送 |
| 權限／使用者快取   | 仍是各節點的 in-memory，失效經平台 DB 的 `LISTEN/NOTIFY` 跨節點（`core/broadcast`；權限快取見 [05 §5.1](./05-rbac.md)，使用者快取見 [`../01-system.md`](../01-system.md) §4.4） |
| Token 到期計時器   | 每個節點只管自己的連線，不需要協調                                                         |

Phase 0 是單一執行個體，**先不裝 adapter**；發佈端（`DomainEventBus`）不因此改變。

---

## 11. 限制與防濫用

`@nestjs/throttler` 只作用在 HTTP，WebSocket 要自己限：

| 項目                     | 限制                                              | 超過時               |
| ------------------------ | ------------------------------------------------- | -------------------- |
| Origin                   | `allowRequest` 檢查 `Origin` 屬於 `REALTIME_ALLOWED_ORIGINS`，或與連線的網域同源（每個租戶自己的網域，ADR-0020 D2） | 拒絕 handshake |
| 每個 IP 的 handshake     | 每分鐘 1200 次（`REALTIME_HANDSHAKES_PER_IP`；整間公司共用一個 NAT 出口、部署後同時重連） | 拒絕 handshake       |
| 每條連線的訊息           | 每 10 秒 30 則                                    | 略過；持續超過就斷線 |
| 單一 frame               | `maxHttpBufferSize` = 16 KB                       | Socket.io 直接斷線   |
| 每個使用者的連線數       | 20（`REALTIME_CONNECTIONS_PER_USER`）              | 拒絕新的 handshake   |

前端同一個瀏覽器只有 leader 分頁連線（[前端 11 §3.3](../frontend/11-realtime.md)），
所以 20 條大約對應 20 個瀏覽器／裝置，而不是 20 個分頁。

新增環境變數：`REALTIME_ALLOWED_ORIGINS`（逗號分隔；開發預設 `http://localhost:5173`）。

- 沒帶 `Origin` 的 handshake 只在非 production 放行（給 Node 測試客戶端用）。
- Origin 與每 IP 次數在 HTTP 升級階段就拒絕，客戶端的 `connect_error` **不帶** `data.code`；
  只有 token 驗證失敗（§3.2）才帶。
- 「每 IP」與 HTTP throttler 用 **同一個** 客戶端 IP 判定：`main.ts` 依 `TRUST_PROXY` 設定 Express 的
  `trust proxy`，gateway 讀 Express 編譯好的 `trust proxy fn`，以 `proxy-addr` 算出與 `req.ip` 相同的結果。
  在 nginx 後面時要設 `TRUST_PROXY`（compose 用 `uniquelocal`），否則所有人共用 nginx 那一個 IP 的額度。

---

## 12. 可觀測性

| 事件                   | 日誌欄位                                          |
| ---------------------- | ------------------------------------------------- |
| handshake 被拒         | `ip`、`code`                                      |
| 連線／斷線             | `socketId`、`userId`、`reason`、`durationMs`      |
| `session.revoked`      | `userId`、`reason`、斷掉的連線數                  |
| 推播                   | `resource`、`kind`、room 數；payload 不記         |

`GET /health/ready` 不因推播停擺而失敗：推播不是必要功能（原則 1）。

---

## 13. 測試

整合測試沿用 Testcontainers，`app.listen(0)` 後用 `socket.io-client` 連線（[07-testing.md](./07-testing.md)）。

| 案例                                                                   | 層     |
| ---------------------------------------------------------------------- | ------ |
| 沒帶 token、token 過期、`token_version` 不符 → `connect_error` 帶正確 `code` | 整合 |
| `session.renew` 換成別人的 token → 拒絕                                | 整合   |
| 到了 `exp` 沒續期 → 收到 `session.expired` 並斷線                      | 整合（假時鐘） |
| 改角色權限 → 持有者與 `role:read` 持有者收到，其他人收不到             | 整合   |
| 被拿掉 `role:read` 之後不再收到角色變更（room 已同步）                 | 整合   |
| 交易 rollback → 沒有任何推播                                           | 整合   |
| 停用使用者 → 該使用者所有連線收到 `session.revoked` 並被斷線           | 整合   |
| `channel.relay` 只到同使用者；非白名單頻道被略過                       | 整合   |
| gateway 有未宣告授權的 `@SubscribeMessage` → 啟動失敗                  | 單元（route-audit） |
| 來源 → 受眾對照（§6.1）                                               | 單元   |
| 新的站內通知只推給收件人（payload 是通知 id），稽核的讀者收不到          | 整合   |
| `DomainEventBus`：同租戶依序、跨租戶與 `sessions.revoked` 不互相阻塞、錯誤隔離、`meta` 在發佈當下擷取 | 單元   |
| `realtime.listener`：四個領域事件各自的動作（假 bus ＋ 假 io）；`tenant.featuresChanged` 推給整個租戶的 room | 單元   |

---

## 14. 安全檢查清單

- [ ] handshake 以 `AccessTokenVerifier` 驗證，與 `JwtAuthGuard` 同一段邏輯
- [ ] token 只從 `handshake.auth` 取，不從 query string
- [ ] 每則客戶端訊息都過 `WsAuthGuard`；每個處理器都有授權宣告（route-audit）
- [ ] `session.renew` 驗證 `sub` 不變
- [ ] 推播 payload 只有 id，不含內容
- [ ] 受眾經過 perm room 過濾；權限變更後同步 room
- [ ] 領域事件在交易後、快取失效後發佈；業務模組不 import `RealtimeModule`
- [ ] `token_version` 遞增的所有路徑都發佈 `sessions.revoked`
- [ ] `channel.relay` 只轉同使用者、有白名單與大小上限
- [ ] Origin 檢查、handshake 與訊息速率限制
