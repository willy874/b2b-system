# 後端 08 — 即時推播（Socket.io）

> 狀態：**已實作（Phase 0，單一執行個體）**。決策理由見 §15；
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
- `RealtimePublisher` 只在 `modules/realtime` 內使用；業務模組仍然只發佈領域事件（§15.3 理由 7）。

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

單一登出（[`architecture/04-sso.md`](../04-sso.md) §12.2 D5）改帶 `idpSessionUids`：只撤銷 `sid:{uid}` room 的連線，
同一個人的其他裝置不受影響；`reason` 是 `SessionRevokedReason.SIGNED_OUT`（`AUTH_REFRESH_REVOKED`）。
平台管理者停用或刪除租戶時帶 `tenantIds`：撤銷 `t:{tenantId}` room 的所有連線，`reason` 是 `TENANT_UNAVAILABLE`
（[`architecture/05-tenancy.md`](../05-tenancy.md) §10.2 D13；這個事件在平台的請求裡發佈，沒有租戶脈絡）。

之前被停用的人要等到「下一次 HTTP 請求」才會被擋下；現在是即時的。
單一裝置的登出不遞增 `token_version`，由該分頁自己斷線（前端 `SessionStore` 的 `ended`）。

### 3.6 平台管理者的連線（apps/platform）

apps/platform 的網域（`PLATFORM_APP_URL` 的 host）不屬於任何租戶（[`architecture/05-tenancy.md`](../05-tenancy.md) §10.2 D2）。
在那裡建立的連線是 **平台管理者** 的，同一個 gateway、同一條 `/api/socket.io`，差別只在 handshake 與 room：

| 項目 | 租戶的連線 | 平台管理者的連線 |
| --- | --- | --- |
| 判定 | handshake 的網域解析到租戶 | handshake 的網域等於 apps/platform 的網域（同 `TenantMiddleware` 判定 `/platform/*` 的方式） |
| 脈絡 | 每則訊息在那個租戶的脈絡裡處理 | 沒有租戶脈絡；`AccessTokenVerifier` 只接受 `realm: 'platform'` 的 token，`checkUser` 查平台 DB 的 `platform_admins` |
| room | `t:{tid}:user:{id}`、`t:{tid}`、`sid:{uid}`、perm room | `platform:admin:{id}`、`platform`、`sid:{uid}` |
| 推播 | `resource.changed` 事件依來源 → 受眾表（§6.1） | `platform.changed` 事件：沒指定收件人就推 `platform` room，有 `adminIds` 只推那些人 |
| 撤銷 | `SESSIONS_REVOKED` 的 `userIds`／`tenantIds` | `SESSIONS_REVOKED` 的 `platformAdminIds`（停用、變更密碼） |

平台的角色只有三種，每一種都有所有平台資源的 `:read`（[`../../rbac/02-permission-catalog.md`](../../rbac/02-permission-catalog.md) §8.2），
所以不分 perm room：平台資源的變更推給所有平台管理者。

平台的來源（`packages/realtime` 的 `ChangeSource`）：

| 來源 | 誰發佈 | 前端失效 |
| --- | --- | --- |
| `platformTenant` | `PlatformTenantService` 的每個寫入、`TenantProvisioner` 的佈建結果 | 租戶清單、詳情、首頁的租戶概況、flag 列表的租戶數 |
| `platformAdmin` | 管理者的新增、編輯、啟用；本人改名 | 管理者清單、自己的 profile（換角色時權限跟著變） |
| `platformFeatureFlag` | 全平台覆寫 | flag 列表 |
| `platformJob` | 重試（工作之後的狀態變化不推，列表照常重抓） | 佇列計數、列表、詳情 |
| `platformNotification` | 平台的站內通知（只推收件人，[`15-notification.md`](15-notification.md) §6.2） | 鈴鐺的未讀數與列表 |

這些來源也在租戶的受眾表（§6.1）裡，規則是「不推給任何人」：出現在 `resource.changed` 代表呼叫端用錯事件。
backstage 的 `apis/resources.ts` 同樣列出它們（空的定義），只為了滿足「伺服器的每個來源都是 `Resource` 的成員」的編譯期檢查。

`platform.changed` 在 `DomainEventRelay` 的轉送清單裡（§7.6）：佈建在背景工作裡跑，worker 拆出去之後，
連在 api 上的平台管理者仍收得到佈建結果。

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
| `t:{tenantId}`         | 這個租戶的所有連線（停用、刪除租戶時一次斷掉；租戶啟用的 feature 變更時推 `tenantFeature`） | `tenantRoom(tenantId)`（[`architecture/05-tenancy.md`](../05-tenancy.md) §10.2 D13、[`frontend/02-plugin-system.md`](../frontend/02-plugin-system.md) §9.2 D8） |
| `t:{tenantId}:perm:{permissionKey}` | 目前租戶裡持有該權限的使用者的連線 | `permRoom(key)`（例 `t:…:perm:role:read`；租戶取自目前的租戶脈絡） |
| `sid:{idpSessionUid}`  | 同一個 IdP session 的連線（經 SSO 登入、token 帶 `sid` 時才加入） | `idpSessionRoom(uid)`（[`architecture/04-sso.md`](../04-sso.md) §12.2 D5） |
| `platform`             | apps/platform 上所有平台管理者的連線（§3.6） | `PLATFORM_ROOM` |
| `platform:admin:{adminId}` | 一位平台管理者的所有連線（§3.6）      | `platformAdminRoom(id)` |

super-admin 加入自己租戶的所有 perm room。

- **perm room 帶租戶**（[`architecture/05-tenancy.md`](../05-tenancy.md) §10.2 D17）：一個程序服務所有租戶，
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
| `notification`     | —                                          | 收件人（`affectedUserIds`；`id` 是通知 id，不是使用者 id） | 站內通知是個人的東西，只推給收件人自己的所有連線（[`backend/15-notification.md`](15-notification.md) §12.2 D8，[`15-notification.md`](./15-notification.md) §7）；不寫稽核，所以 **不** 加 `auditLog:read` |
| `notificationPolicy` | `system:read`                            | —                                  | 事件管理頁（[`16-notification-event.md`](./16-notification-event.md) §4；與系統設定同一群讀者） |
| `platformTenant`、`platformAdmin`、`platformFeatureFlag`、`platformJob`、`platformNotification` | —（不經這張表） | — | 平台的來源：由 `platform.changed` 推給平台管理者的 room（§3.6）。表裡的列是空的、也不加 `auditLog:read`，只為了讓 `Record<ChangeSource, …>` 完整 |
| `serviceAccount`   | `serviceAccount:read`                      | —                                  | 服務帳號的列表與詳情（[`architecture/06-external-api.md`](../06-external-api.md) §9 T4）；服務帳號沒有連線，不推本人 |
| `apiToken`         | `serviceAccount:read`、`user:update`       | 個人 token 的擁有者（`affectedUserIds`） | 服務帳號的 token（`refs.serviceAccount`）、使用者詳情頁的 token、自己的個人 token |
| `webhook`          | `webhook:read`                             | —                                  | Webhook 的列表與詳情（[`17-webhook.md`](./17-webhook.md)）；自動停用也推 |
| `tag`              | `file:access`、`file:read`、`user:read`    | —                                  | 標籤的定義（[`18-tag.md`](./18-tag.md) §4）；貼與移除由擁有者推自己的資源 |
| `announcement`     | `announcement:read`                        | —                                  | 公告與發送紀錄（[`19-announcement.md`](./19-announcement.md)）；背景發送的狀態也推 |
| `webhookDelivery`  | `webhook:read`                             | —                                  | 每一次投遞嘗試（`refs.webhook`）；投遞不寫稽核，所以 **不** 加 `auditLog:read` |
| `notificationPreference` | —                                    | 本人（`affectedUserIds`）          | 自己的通知設定（[`16-notification-event.md`](./16-notification-event.md) §5）；不寫稽核，所以 **不** 加 `auditLog:read` |
| 任何來源（`notification`、`notificationPreference`、`webhookDelivery` 除外） | `auditLog:read`                 | —                                  | 每次寫入都會新增一筆稽核（`derivesFromAnyChange`）；規則上標 `recordsAudit: false` 的來源不算 |

- `io.to([...rooms]).emit()` 會對多個 room 的聯集 **去重**，同一條連線只收到一次。
- 「持有該角色的所有人」含 **經由群組（含巢狀）持有** 的人（[`rbac/08-groups.md`](../../rbac/08-groups.md) §1），由 service 以
  `PermissionService.findUserIdsHoldingRole` 查出（刪除角色時在軟刪除之前、交易內查出；持有者邊保留，[`backend/14-revisions.md`](14-revisions.md) §9.2 D2），
  只用來讓他們的畫面重抓；權限快取的失效與 room 的同步不依賴這份清單（[05 §5.1](./05-rbac.md)）。
- 前端以 profile 的角色清單判斷「我是不是這個角色的持有者」，而 profile 只列直接持有的角色。所以角色的權限改變、刪除、還原、
  還原到改了權限鍵的版本時，**只經由群組持有** 的人另外各推一筆本人的 `userRole update`（`refs.role`），前端以「是不是自己」重抓 profile。
  人多到一則放不下時改成一筆不帶 id 的 `userRole update`（收到的人都重抓自己的 profile）。
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
| `resource.changed`     | `{ changes: ResourceChangeWire[], affectedUserIds?, perRecipient? }` | 所有會改變畫面資料的寫入         | 依 §6.1 算出 room，推 `resource.changed`；`perRecipient`（`{ userId, changes }[]`）的每一項另外推一則只有他那幾筆的 `resource.changed` 到他的 user room，不經 perm room（站內通知：一批收件人一則事件，通知 id 不給別人看到） |
| `sessions.revoked`     | `{ userIds?, idpSessionUids?, tenantIds?, platformAdminIds?, reason }` | 遞增 `token_version` 的寫入      | 推 `session.revoked` 並斷線（§3.5；平台管理者見 §3.6） |
| `tenant.featuresChanged` | `{ tenantId }`                                          | 平台管理者改了租戶的 `features` 或 feature flag 的租戶覆寫（`PlatformTenantService.update`，`TenantDirectory.invalidate()` 之後）；改了 flag 的全平台覆寫時對每個 `active` 租戶各發一次（`PlatformFeatureFlagService.update`） | 對 `t:{tenantId}` 推 `resource.changed`（`{ resource: 'tenantFeature', kind: 'update' }`，沒有 `origin`）；前端重新取得 profile（[`frontend/02-plugin-system.md`](../frontend/02-plugin-system.md) §9.2 D8） |
| `platform.changed`     | `{ changes: ResourceChangeWire[], adminIds? }`            | 平台層級的寫入（租戶登記、平台管理者、全平台 flag、背景工作的重試、平台的站內通知），沒有租戶脈絡 | 推 `resource.changed` 給 `platform` room；有 `adminIds` 時只推給 `platform:admin:{id}`（§3.6） |

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
  // 持有者含經由群組持有的；只經由群組持有的人另外各一筆本人的 userRole update（§6.1）
  const { holders, viaGroupsOnly } = await this.holdersOf(roleId);
  await this.permissionService.permissionsChanged(holders);
  this.events.publish(DomainEvent.RESOURCE_CHANGED, {
    changes: [
      { resource: ChangeSource.ROLE_PERMISSION, kind: ChangeKind.UPDATE, id: roleId },
      ...holderRefreshChanges(roleId, viaGroupsOnly, 1),
    ],
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
| 角色更新                     | `role update`，持有者（含經由群組的）                | —                                                         |
| 角色權限增減                 | `rolePermission update` ＋ 只經由群組持有的人各一筆 `userRole update`，持有者（含經由群組的） | 先發 `permissions.changed`         |
| 角色刪除                     | `role delete` ＋ 只經由群組持有的人各一筆 `userRole update`，原本的持有者（含經由群組的，軟刪除前查出） | 先發 `permissions.changed` |
| 角色還原                     | `role create` ＋ 每位持有者（含經由群組的）一筆 `userRole update`（`refs.role`；超過上限時一筆不帶 id），持有者 | 先發 `permissions.changed`（`userIds` = 持有者） |
| 角色還原到某一版             | `role update`；改了權限鍵時另加 `rolePermission update` 與只經由群組持有的人的 `userRole update`，持有者 | 改了權限鍵時先發 `permissions.changed` |
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
| 寫入站內通知（`NotificationService.notify()`） | 一批一則事件：`changes` 是空的，`perRecipient` 帶每位收件人自己的 `notification create`（id 是他自己的通知 id，一次超過 100 則時不帶 id）；由 `afterCommit` 在交易提交時就發出，早於同一個操作在交易後才發的事件 | —                                        |
| 通知標為已讀／全部已讀       | `notification update`（單則帶 id；全部已讀不帶），`affectedUserIds` = 自己 | —                                    |
| 開關事件通知（`PATCH /notification-events`） | `notificationPolicy update`（每個改到的事件一筆，id 是事件類型） | —                                    |
| 修改自己的通知設定（`PATCH /me/notification-preferences`） | `notificationPreference update`（每個改到的事件一筆，id 是事件類型），`affectedUserIds` = 自己 | —                                    |
| 服務帳號建立／修改／刪除／指派角色 | `serviceAccount create` / `update` / `delete`，加上持有者變動的角色各一筆 `role update` | —                                       |
| 建立／撤銷 API token         | `apiToken create` / `apiToken update`；服務帳號的帶 `refs.serviceAccount`，個人的 `affectedUserIds` = 擁有者 | —           |
| 標籤的建立、改名、改色、刪除 | `tag create` / `update` / `delete` | —                                       |
| 公告的建立、修改、送出、暫停、恢復、刪除、還原；背景發送與撤回 | `announcement create` / `update` / `delete`（還原以 create） | 撤回另推 `notification delete` 給收件人 |
| 貼與移除標籤 | 擁有者的資源：`file update`（`refs.fileFolder`）、`fileFolder update`、`user update` | —                    |
| Webhook 建立／修改／停用／輪替密鑰／刪除 | `webhook create` / `update` / `delete` | —                                       |
| Webhook 投遞（背景工作、送測試事件、重送） | `webhookDelivery create`（`refs.webhook`）；連續失敗自動停用時另加 `webhook update` | —      |
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

api 之外還會有別的程序寫入資料：對外 API（[`architecture/06-external-api.md`](../06-external-api.md) §9.2 D9）、之後拆出的 worker、
多個 api 執行個體。bus 在行程內，那些程序發佈的事件，連在 api 上的使用者原本收不到。

`core/events/event-relay.ts` 把 **推播類** 事件經平台 DB 的 `NOTIFY`（頻道 `domain_event`，`core/broadcast`）送給其他程序：

| 事件 | 轉送 | 理由 |
| --- | --- | --- |
| `resource.changed`、`sessions.revoked`、`tenant.featuresChanged`、`platform.changed` | ✅ | 推播是「每個程序對自己的連線做一次」 |
| `permissions.changed` | ❌ | `AuthzRevision` 已經以 revision 廣播，收到的程序重新發佈（[05 §5.1](./05-rbac.md)） |
| `tenant.activated` | ❌ | 訂閱者（補系統資料夾）寫資料庫，整個系統做一次就夠 |

- **只到願意收的訂閱者**：收到的程序在發佈端的租戶脈絡裡（`Tenancy.run`）以 `deliverRemote` 交給本機的 bus，
  只有以 `{ remote: true }` 訂閱的 handler 收得到（目前只有 `realtime.listener`）。寫資料庫、撤銷 OIDC session 這類
  「整個系統做一次」的訂閱者維持預設，不會在每個程序重複執行。
- **不會繞圈**：轉送只訂閱本機發佈的事件；`channel()` 的信封帶送出的程序，自己送的不會收回來。
- **`meta` 跟著過去**：`clientId`（`origin`）、`requestId`、`occurredAt` 照發佈端的；`meta.remote` 標成 `true`。
- **超過合約的上限**（`changes` 超過 100 筆、`refs` 過長）：轉送前先套用 `limitChanges()`（§9），接收端的驗證與客戶端同一個上限，否則整則被拒收。
- **放不進一則 `NOTIFY`（8000 位元組）**：資源變更拿掉個別的 `id`／`refs`（`coarsenChanges()`），退化成「這個來源全部失效」，受影響的人每 150 個一則；
  撤銷連線的名單每 150 個一則。
- **`perRecipient`**（站內通知）：依位元組裝成幾則（每則數十人），每個人的 id 照帶；一個人的變更自己就放不進一則時只有他那一筆退化成不帶 id 的。
  共用的 `changes` 放得進就原樣一則。
- **不讓 bus 的佇列等 `NOTIFY`**：handler 把拆好的訊息交給送出佇列就返回，同一個租戶的下一則推播不必排在平台 DB 的往返後面。
  送出佇列與 bus 的佇列同樣切法（每個租戶一條、另加優先通道），每條依序送出，接收端照順序處理；整個程序最多排 1000 則，
  滿了就略過新的事件並記 warn（不保證送達，見下）。
- **只送不收的程序**：對外 API 沒有推播（沒有 `{ remote: true }` 的訂閱者），以 `EventsModule.sendOnly()` 組裝：照樣把自己的寫入轉送出去，
  但不 `LISTEN` `domain_event`（`BroadcastService.sender()`），少一條監聽的連線、也不必解析內部 api 轉來的每一則。
- **租戶進不去**（停用、維護中）就略過：它的連線已經或即將被斷掉。格式不對的訊息（不同版本並存）略過。
- 不保證送達，與 bus 同一個等級；漏掉時前端在下一次重新連線、或下一次自己抓資料時看到新資料。

---

## 8. 跨裝置中繼：`channel.relay`

讓前端 `@b2b-system/web-shared/channel` 的頻道可以跨裝置（例：偏好設定）。伺服器不理解 payload，只轉送：

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
  /** 平台管理者變更了租戶啟用的 feature；前端據此重新取得 profile（[`frontend/02-plugin-system.md`](../frontend/02-plugin-system.md) §9.2 D8）。 */
  TENANT_FEATURE: 'tenantFeature',
  /** 站內通知（id = 通知 id）；只推給收件人（[`backend/15-notification.md`](15-notification.md) §12.2 D8）。 */
  NOTIFICATION: 'notification',
  /** 事件管理的租戶政策（id = 事件類型；[`backend/16-notification-event.md`](16-notification-event.md) §9.2 D9）。 */
  NOTIFICATION_POLICY: 'notificationPolicy',
  /** 自己的通知設定（id = 事件類型）；只推給本人（[`backend/16-notification-event.md`](16-notification-event.md) §9.2 D15）。 */
  NOTIFICATION_PREFERENCE: 'notificationPreference',
  /** 服務帳號（[`architecture/06-external-api.md`](../06-external-api.md) §9 T4）。 */
  SERVICE_ACCOUNT: 'serviceAccount',
  /** API token；服務帳號的帶 `refs.serviceAccount`（[`architecture/06-external-api.md`](../06-external-api.md) §9 T4）。 */
  API_TOKEN: 'apiToken',
  /** Webhook 訂閱（[`backend/17-webhook.md`](17-webhook.md) §9）。 */
  WEBHOOK: 'webhook',
  /** Webhook 的一次投遞嘗試；帶 `refs.webhook`，不寫稽核（[`backend/17-webhook.md`](17-webhook.md) §9）。 */
  WEBHOOK_DELIVERY: 'webhookDelivery',
  /** 標籤的定義（[`backend/18-tag.md`](18-tag.md) §7）；指派由擁有者推自己的資源。 */
  TAG: 'tag',
  /** 公告與發送紀錄（[`backend/19-announcement.md`](19-announcement.md) §9）。 */
  ANNOUNCEMENT: 'announcement',
  /** 平台的來源：只推給 apps/platform 上平台管理者的連線（§3.6）。 */
  PLATFORM_TENANT: 'platformTenant',
  PLATFORM_ADMIN: 'platformAdmin',
  PLATFORM_FEATURE_FLAG: 'platformFeatureFlag',
  PLATFORM_JOB: 'platformJob',
  PLATFORM_NOTIFICATION: 'platformNotification',
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
- **伺服器負責守住上限**：`changes` 最多 `MAX_CHANGES_PER_EVENT`（100）筆、每個 `refs` 陣列最多 100 個，超過的一則客戶端會整則丟掉。
  `realtime.listener` 送出 `resource.changed`（含平台的）之前、`DomainEventRelay` 轉送之前都套用 `limitChanges()`：超過時改成
  `coarsenChanges()` 的結果——同一個 `{ resource, kind }` 只留一筆、拿掉 `id` 與 `refs`，前端視為「這個來源全部失效」。
  受眾仍以原本的變更計算（`includesSubject` 要看 id）。呼叫端知道自己可能很多筆時，自己先降成不帶 id 的宣告（例：角色還原的 `userRole update`、
  站內通知、回收桶一批 `MAX_CHANGES_PER_EVENT` 個），讓其他筆仍帶得到 id。
- 新增事件＝在這裡加名稱與 schema →（需要時）`core/events` 加領域事件 → `realtime.listener` 或 gateway → 前端 `@b2b-system/web-core/realtime` 的處理，**同一批**修改。
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
| Origin                   | `allowRequest` 檢查 `Origin` 屬於 `REALTIME_ALLOWED_ORIGINS`，或與連線的網域同源（每個租戶自己的網域，[`architecture/05-tenancy.md`](../05-tenancy.md) §10.2 D2） | 拒絕 handshake |
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
| 新的站內通知只推給收件人（payload 是通知 id），稽核的讀者收不到；一批多人只發一則事件，每人只收到自己的 id | 整合   |
| 經由群組持有角色、沒有 `role:read` 的成員：角色的權限改變後收到本人的 `userRole update` | 整合   |
| 還原有 100 位以上持有者的角色：收到的 `resource.changed` 通過 `ResourceChangedSchema` | 整合   |
| 超過 100 筆的變更（含平台的）送出前退化成不帶 id 的版本；`perRecipient` 逐人推到自己的 user room | 單元（`realtime.listener.spec.ts`） |
| 轉送：超過 100 筆但放得進一則的事件接收端仍收得到；`perRecipient` 依位元組拆成有上限的幾則；不讓 bus 等 `NOTIFY`；只送不收 | 單元（`event-relay.spec.ts`） |
| `DomainEventBus`：同租戶依序、跨租戶與 `sessions.revoked` 不互相阻塞、錯誤隔離、`meta` 在發佈當下擷取 | 單元   |
| `realtime.listener`：五個領域事件各自的動作（假 bus ＋ 假 io）；`tenant.featuresChanged` 推給整個租戶的 room；`platform.changed` 推給 `platform` 或指定的平台管理者 | 單元   |
| 平台管理者的連線（§3.6，`test/platform-realtime.spec.ts`）：apps/platform 的網域只接受平台的 token、租戶網域不接受平台的 token；租戶改名推給所有平台管理者；通知只推收件人；停用 → `session.revoked` 並斷線 | 整合 |

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

---

## 15. 設計決策：以 Socket.io 做伺服器推播

> 原 ADR-0008，2026-09-24 決定。相關決策：[`backend/04-auth.md`](04-auth.md) §10、[`backend/05-rbac.md`](05-rbac.md) §11。

### 15.1 背景

決策當時，所有「資料變了」的通知都只在 **同一個瀏覽器** 內流動：同一瀏覽器的另一個分頁靠 `query-invalidate` 頻道（BroadcastChannel）即時收到；
另一台裝置、另一個使用者要等 TanStack Query 的 `staleTime` 或 window focus（數分鐘）；
角色被改的人，畫面上的按鈕與選單要等 `GET /auth/profile` 定期重抓（≤ 5 分鐘）；
被停用或強制登出的人，要到下一次 HTTP 請求才被 `AUTH_TOKEN_STALE` 擋下。

後端授權判斷已經是即時的（權限快取主動失效），缺的是 **把「變了」推到瀏覽器**。
之後的協作編輯、資源鎖定、長任務進度等功能也都需要伺服器主動推送。

### 15.2 決定

- 採用 **Socket.io v4**：後端 `@nestjs/websockets` ＋ `@nestjs/platform-socket.io`，前端 `socket.io-client`。
- 路徑 `/api/socket.io`，**只用 `websocket` 傳輸**（關閉 long-polling）。
- 驗證走 **handshake 的 `auth.token`**（access token），不走 cookie；token 到期前以事件續期。
- 伺服器推的是 **來源變更**（`ResourceChangeEvent[]`），前端沿用既有的資源依賴圖換算要失效的 query。
- 受眾以 room 控制：`user:{id}`（本人所有連線）與 `perm:{permissionKey}`（持有該權限的人）。
- 業務 service 不直接呼叫 Socket.io：交易提交後發佈 **領域事件**（`core/events` 的 `DomainEventBus`），
  由 `modules/realtime` 訂閱後推播。推播與快取失效一樣 **在交易之後**。
- WebSocket 的訊息處理器與 HTTP 路由一樣 **預設拒絕**：沒宣告授權就啟動失敗。
- 事件合約放在新的 `packages/realtime`（zod schema ＋ 型別），前後端共用。
- 多執行個體時用 `@socket.io/postgres-adapter`，不引入 Redis。

### 15.3 理由

1. **Room 與廣播是這個需求的核心，而 Socket.io 內建。**「推給持有 `role:read` 的所有人」
   「推給這個使用者的所有裝置」就是 `io.to([...rooms]).emit()`，多 room 的聯集自動去重。
   原生 `ws` 要自己維護 `Map<room, Set<socket>>` 以及跨節點的同步。
2. **跨執行個體的擴展有現成 adapter，而且可以用既有的 Postgres。**
   `@socket.io/postgres-adapter` 走 `LISTEN/NOTIFY`，正好是 [`05-rbac.md`](./05-rbac.md) §5.2
   為權限快取預留的升級路徑，兩者可以共用同一套基礎設施。
3. **自動重連、心跳、ack 不必自己寫。** 斷線偵測（`pingInterval` / `pingTimeout`）與指數退避重連
   都是容易寫錯、又和業務無關的部分。
4. **NestJS 有一級支援。** `@WebSocketGateway`、`@SubscribeMessage` 讓事件處理器可以掛 decorator，
   沿用「宣告式授權 ＋ 啟動時稽核」的既有模式。
5. **前端的傳輸層抽象已經就緒。** `@b2b-system/web-shared/channel` 的傳輸層可替換，只要多寫一個
   `serverRelayTransport()`；`createChannel` 的語意（略過自己、去重、未知 type 略過）不變。
6. **推來源變更、不推失效目標。** 伺服器不需要知道前端有哪些 query key；
   `PROFILE` 這類「以登入者為視角」的衍生（`isSelf`、`selfHoldsRole`）只有客戶端算得出來。
7. **以領域事件解耦發佈端與推播。** 業務模組只宣告「發生了什麼」，不 import realtime；
   受眾的判斷集中在 listener。之後的訂閱者（通知信、webhook）或換成 transactional outbox 都不用改發佈端。
8. **只用 websocket 傳輸。** 免去 long-polling 對 sticky session 的依賴（多執行個體時 LB 不必做親和性），
   也少了一條要處理 CSRF 的 HTTP 路徑。這是內部後台，使用環境可控。

### 15.4 代價

| 代價 | 緩解 |
| --- | --- |
| **Socket.io 是自有協定**，不是標準 WebSocket；客戶端必須用 `socket.io-client` | 對外介面不暴露 Socket.io 的型別：前端只有 `packages/web-core/src/realtime/socketIoTransport.ts`（實作 `RealtimeTransport`）、後端只有 gateway / publisher / expiry / types 四個檔案接觸，🔒 由 boundary 測試守住；換掉時只換這幾個檔案（[`../frontend/11-realtime.md`](../frontend/11-realtime.md) §2、本章 §2.1） |
| 前端 bundle 增加約 15 KB（gzip） | 可接受；登入後才連線，可與 App Shell 一起分包 |
| **`JwtAuthGuard` 對非 HTTP 直接放行**，路由稽核也看不到 `@SubscribeMessage` | 連線 middleware 驗證 token；路由稽核延伸到 gateway（§5） |
| 長連線會比 5 分鐘的 access token 活得久 | 伺服器在 `exp` 到期時斷線；客戶端在 token 續期時送 `session.renew` |
| 開著的分頁會持續續期 token，session 不會因閒置而結束 | 與「開著就是在用」的後台使用情境一致；需要閒置登出時放在 `SessionStore`，不靠連線 |
| 推播不保證送達（斷線期間的事件會遺失） | 重連後整批重新驗證 active query；推播只是加速，正確性仍由 HTTP 與 `staleTime` 保證 |
| 同源的分頁要協調誰持有連線 | Leader 選舉（心跳 ＋ 任期）與 control channel，參考 fortes1219/socket-meetup-frontend；每個瀏覽器只有一條連線（[`../frontend/11-realtime.md`](../frontend/11-realtime.md) §3.3） |
| leader 當掉到有人接手之間（最多約 3 秒）沒有推播 | 新 leader 連上後廣播 `resync`，所有分頁整批重新驗證；推播只是加速 |
| 關閉 long-polling 後，擋 WebSocket 的網路環境無法使用推播 | 推播失效時功能退化成定期重抓，不會壞掉 |

### 15.5 替代方案

| 方案 | 不採用的理由 |
| --- | --- |
| 原生 `ws` ＋ 自訂協定 | 前端已有 `webSocketTransport`，協定最輕。但 room、跨節點廣播、心跳、重連都要自己寫；之後協作編輯需要的 ack 也要自己做 |
| Server-Sent Events | 單向即可滿足失效通知，而且是純 HTTP。但 `EventSource` 無法帶 `Authorization` header（只能用 cookie 或 query string，前者要改 cookie Path，後者 token 會進日誌）；之後的雙向需求（協作、鎖定）還是要另外一套 |
| 輪詢（縮短 `staleTime` / profile 間隔） | 零新基礎設施，但延遲與請求量成反比，而且無法即時強制登出 |
| 託管服務（Pusher、Ably 等） | 多一個外部依賴與資料出境；授權要再做一次 token 交換 |
| Redis adapter | 功能相同，但要多維運一個 Redis；Postgres 已經在，量級也遠不到瓶頸 |
| 每個分頁各自一條連線 | 最簡單，但同一則推播在每個分頁都要解析、換算、重抓；開十個分頁就是十倍的伺服器連線與請求 |
| 用 SharedWorker 持有唯一的連線 | 連線數同樣最少。但 access token 只在分頁記憶體（[`backend/04-auth.md`](04-auth.md) §10），要傳進 worker；Android Chrome 沒有 SharedWorker |
| Web Locks（`navigator.locks` 的 `steal`）選 leader | 分頁關閉時鎖自動釋放、不必心跳。但被搶走的一方只能從 promise reject 得知，可見性驅動的讓位與「並排不互搶」要另外做；心跳版本的每一步都能以假計時器決定性地測試 |
| Service 直接注入 `RealtimePublisher` | 最少一層間接，但每個業務模組都要依賴 realtime；拿掉或替換推播要改遍所有 service |
| `@nestjs/event-emitter` | 功能足夠，但事件名稱與 payload 沒有型別對照、handler 預設並行，無法保證「room 先同步再推播」的順序 |
| 伺服器直接推失效的 query key | 客戶端最省事，但伺服器要認得前端的 query 結構，且算不出以登入者為視角的衍生 |
