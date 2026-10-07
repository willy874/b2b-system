# 後端 04 — 認證

> 授權（誰能做什麼）見 [`05-rbac.md`](./05-rbac.md)。本章只談「你是誰」。

## 1. Token 策略

|                | Access Token                  | Refresh Token                      |
| -------------- | ----------------------------- | ---------------------------------- |
| 格式           | JWT（HS256，header 帶 `kid`；§11） | 不透明隨機值（32 bytes base64url） |
| 壽命           | **5 分鐘**                    | **7 天**；家族（一次登入）最長 **30 天**（§2.6） |
| 存放（客戶端） | **記憶體**（JS 閉包）         | `httpOnly` cookie                  |
| 存放（伺服器） | 不存                          | SHA-256 雜湊後存 `refresh_tokens`  |
| 內容           | 租戶：`{ sub, ver, jti, tid, iat, exp }`；平台管理者：`{ sub, ver, jti, realm: 'platform', iat, exp }`；經 SSO 登入時多 `sid`（IdP session） | 無語意；經 SSO 發出時記 `client_id`、`idp_session_uid` |
| 輪替           | 不適用                        | **每次使用即輪替**                 |
| 撤銷           | 靠 `token_version` 比對       | DB 標記 `revoked_at`               |

### 1.1 為什麼 access token 不帶權限

JWT 一旦簽出就無法撤回其內容。若權限寫在 token 裡，管理員移除某人的權限後，
那個人手上的 token 在到期前仍然有效——5 分鐘的安全空窗。

改成每次請求查詢權限集合（有快取），換來「權限變更立即生效」。
代價是一次快取查詢（命中時 < 1 ms）。詳見
[`05-rbac.md`](./05-rbac.md) §11。

Token 裡因此只有這幾樣東西：

- `sub` — 使用者 ID
- `ver` — 簽發時的 `users.token_version`
- `jti` — 供稽核追蹤
- `tid` — 簽發時的租戶 id（[`architecture/05-tenancy.md`](../05-tenancy.md) §10.2 D10）：使用者 id 只在自己的租戶 DB 有意義，
  驗證時 `tid` 必須等於請求網域決定的租戶，否則 `AUTH_TOKEN_INVALID`，不會拿去查別的租戶的使用者
- `realm: 'platform'` — 平台管理者的 token（取代 `tid`）：只在不屬於任何租戶的網域（apps/platform）有效
- `sid` — 經 SSO 登入時的 IdP session（[`../04-sso.md`](../04-sso.md) §12.2 D5）

簽章金鑰依 realm 分成兩組金鑰環，header 的 `kid` 指出用哪一把（§11）。

### 1.2 `token_version` 的角色

這是 **唯一的 access token 撤銷機制**。

```
users.token_version += 1  發生於：
  · 使用者被停用 / 刪除
  · 密碼被變更或重設
  · 管理員執行「強制登出」

JwtAuthGuard 驗簽後比對：
  payload.ver !== user.token_version  → 401 AUTH_TOKEN_STALE
```

前端收到 `AUTH_TOKEN_STALE` 時 **不嘗試續期**，直接登出——這個碼的意思就是
「這個 session 已被管理端終止」。

### 1.3 為什麼 refresh token 不是 JWT

它不需要攜帶任何資訊。用不透明隨機值 ＋ DB 查詢，換來的是 **可撤銷性** 與
**重用偵測**——這兩件事 JWT 做不到。

---

## 2. Refresh Token 輪替與重用偵測

### 2.1 家族（Family）

一次登入建立一個 `family_id`。之後每次續期：

```
[登入]  family=F, token=T1                            (used_at=null)
   │
[續期] T1 → 標記 T1.used_at=now，新增 T2 (family=F)
   │
[續期] T2 → 標記 T2.used_at=now，新增 T3 (family=F)
```

### 2.2 重用偵測

若收到一個 `used_at IS NOT NULL` 的 token，代表：

- 有人拿到了被竊取的舊 token，或
- 客戶端的跨分頁協調失敗（兩個分頁同時用了同一個舊 token）

除了下面的 **重送寬限期**（§2.3 的最後一段），都當成攻擊處理：

```sql
UPDATE refresh_tokens
SET revoked_at = now(), revoked_reason = 'reuse_detected'
WHERE family_id = $1 AND revoked_at IS NULL;
```

**整條家族失效**，使用者被登出，必須重新登入。同時寫入一筆高嚴重度的稽核紀錄
（`auth.refresh.reuse_detected`）。

> 這就是為什麼前端的跨分頁互斥（Web Locks）不是最佳化，而是 **必要**。
> 見 [`../frontend/09-state-and-storage.md`](../frontend/09-state-and-storage.md) §5.1。

### 2.3 完整判定

```ts
async refresh(rawToken: string, ctx: RequestContext) {
  const hash = sha256(rawToken);
  const row = await this.tokenRepo.findByHash(hash);

  if (!row)                        throw new AppException(ErrorCode.AUTH_REFRESH_INVALID);
  if (row.revokedAt || await this.tokenRepo.isFamilyRevoked(row.familyId)) {
    if (await this.wasUsed(row))   return this.rejectReuse(row, ctx); // 用過的 token 再出示＝重用
                                   throw new AppException(ErrorCode.AUTH_REFRESH_REVOKED);
  }
  if (row.expiresAt < new Date())  throw new AppException(ErrorCode.AUTH_REFRESH_EXPIRED);
  if (row.usedAt)                  return this.rejectReuse(row, ctx); // 撤銷家族 ＋ 稽核 ＋ REUSED

  const user = await this.userRepo.findById(row.userId);
  if (!user || user.deletedAt)     throw new AppException(ErrorCode.AUTH_REFRESH_INVALID);
  if (user.status !== 'active')    throw new AppException(ErrorCode.AUTH_ACCOUNT_DISABLED);

  const raw = await withTransaction(this.db, async (tx) => {
    // UPDATE … WHERE used_at IS NULL AND revoked_at IS NULL：0 列代表被併發請求搶先
    if (!(await this.tokenRepo.markUsed(row.id, tx))) return undefined;
    const next = await this.tokenRepo.issue({ userId: user.id, familyId: row.familyId, ...ctx }, tx);
    return next.raw;
  });
  if (raw === undefined) {
    if (await this.wasUsed(row)) return this.rejectReuse(row, ctx);   // 被併發請求用掉
    throw new AppException(ErrorCode.AUTH_REFRESH_REVOKED);           // 被併發的登出撤銷
  }
  return { accessToken: this.signAccessToken(user), refreshToken: raw };
}
```

**注意 `markUsed` 與 `issue` 在同一個交易裡**：否則有可能標記了舊 token 卻沒
建立新的，使用者被無故登出。

**`markUsed` 必須是條件式 `UPDATE`**：先 `SELECT` 看 `used_at` 再無條件標記的話，
同一張 token 的兩個併發請求都會通過檢查、各自換發一張，家族分岔成兩條有效的鏈，
重用偵測完全沒觸發。條件式 `UPDATE` 由列鎖序列化，只有一個搶得到。

**「用過」優先於「已撤銷」**：同一張 token 的併發請求裡，第一個失敗者觸發重用偵測並撤銷整條家族，
後到的失敗者會看到家族已撤銷。它們出示的仍是一張已被用掉的 token，所以一樣判定為重用（`wasUsed()`
重新讀取當下的 `used_at`，因為請求一開始讀到的列可能已過時）。沒被用過的 token 碰上撤銷
（登出後漏網的那張、重用偵測後贏家手上的新 token）才是 `AUTH_REFRESH_REVOKED`。

**為什麼也要看整個家族**：登出的 `revokeFamily` 與一個併發的續期交易同時進行時，
續期新插入的那一列不在 `UPDATE` 的快照裡，不會被撤銷。撤銷一律以家族（或使用者）
為單位，所以「家族裡有任一列已撤銷」就等於整個家族已失效（`superseded` 除外，見下一段）。
每次續期都要問這一題，所以有只索引已撤銷列的 `refresh_tokens_family_revoked_idx`。

**重送寬限期**（`REFRESH_REUSE_GRACE_SECONDS`，預設 30 秒，0 停用）：續期成功、但回應在抵達瀏覽器前遺失
（逾時、斷線、代理逾時）時，瀏覽器會再出示剛被用掉的那張。若它被使用還不到寬限期，**而且它是家族裡最後
被使用的一張**，就不當成重用：在同一個交易裡鎖住它、把家族目前的最新一張標成 `revoked_reason = 'superseded'`，
再發一張新的，稽核記 `auth.refresh.replayed`（一般嚴重度）。家族不會分岔（任何時候只有一張可用），
被取代的那張再出示是 `AUTH_REFRESH_REVOKED`。超過寬限期、或家族在它之後又續期過，照舊判定為重用。
取捨：寬限期內被偷的 token 可以換到新的一張（原本的主人下次續期會被登出），換來的是網路抖動不會登出使用者、
也不會產生假的高嚴重度警報。

### 2.4 Cookie

```
Set-Cookie: refresh_token=<value>;
            HttpOnly;
            Secure;                      (production)
            SameSite=Lax;
            Path=/api/auth;              ★ 只有 /api/auth/* 會帶上（見下方說明）
            Max-Age=604800
```

`Path` 讓一般 API 請求根本不攜帶這個 cookie，縮小暴露面。

> **Path 必須是「瀏覽器看到的」路徑**。前端一律打 `/api/*`（dev 由 Vite proxy、
> prod 由反向代理去掉前綴），所以這裡是 `/api/auth` 而不是 `/auth`——
> 設成 `/auth` 會讓 cookie 永遠不被送出，重新整理後就必須重新登入。
> 由 `REFRESH_COOKIE_PATH` 設定，部署時要與反向代理的前綴一致。

### 2.5 CSRF

CSRF 的標的有兩種：**靠 cookie 認證** 的端點（`/auth/refresh`），以及會 **設定** session cookie 的公開端點
（`POST /auth/sso/callback`、`POST /platform/auth/sso/callback`、`POST /auth/login`）。後者的風險是登入 CSRF：
攻擊者以自己的授權碼（或帳密）組一個自動送出的跨站表單，`SameSite` 只限制「送出」cookie，不限制頂層導覽的回應「設定」cookie，
受害者的瀏覽器就收下攻擊者的 refresh cookie，之後的操作都落在攻擊者的帳號裡。

會設定 session cookie 的端點標 `@JsonBodyOnly()`：只接受 `Content-Type: application/json`，其他回 `415 UNSUPPORTED_MEDIA_TYPE`。
跨站的 HTML 表單只能送 urlencoded、multipart、text/plain；跨站的 fetch 帶 `application/json` 要先過 preflight，而 api 不回其他來源的 CORS。
不全域關掉 urlencoded：`/oidc/token` 依規格要它。前端另有縱深防禦：`SessionStore` 已經有身分時，
續期（含其他分頁的 `refresh-done`）拿到的 access token 若是另一個身分（`sub`／`tid` 不同），不採用並以 `identity_changed` 結束 session。

`/auth/refresh` 的防護：

1. `SameSite=Lax` — 阻擋跨站的 `POST`
2. **要求自訂標頭 `x-refresh-request: 1`** — 帶自訂標頭的跨站請求會觸發
   preflight，而我們不對其他來源回應 CORS，preflight 就過不了

```ts
@Post('refresh')
@Public()
async refresh(@Req() req: Request) {
  if (req.header('x-refresh-request') !== '1') {
    throw new AppException(ErrorCode.AUTH_REFRESH_INVALID);
  }
  // …
}
```

### 2.6 絕對壽命

每張 refresh token 帶 `family_created_at`（登入的時間，輪替時沿用）。超過 `REFRESH_FAMILY_MAX_AGE`
（預設 30 天）就回 `AUTH_REFRESH_EXPIRED`，不論期間續期了幾次；快到期時新 token 與 cookie 的壽命也截短到家族的期限。
被偷的 refresh cookie 不能靠持續續期永久使用。

### 2.7 跨分頁協調的續期

前端的 `SessionStore`（`packages/web-core`）讓同一瀏覽器的分頁依序續期；後端的判定見 §2.3。

```
分頁 A                    SessionStore               分頁 B
  │                           │                        │
  │─ 需要發請求 ─────────────▶│                        │
  │                    ┌──────┴──────────────────┐     │
  │                    │ ensureAccessToken()     │     │
  │                    │  剩餘壽命 > 30s？        │     │
  │                    │   是 → 直接回傳          │     │
  │                    │   否 → 往下              │     │
  │                    │  已有 in-flight refresh？│     │
  │                    │   是 → 共用那個 promise  │     │
  │                    └──────┬──────────────────┘     │
  │                           │                        │
  │                           │─ navigator.locks ─────▶│ 取得續期鎖（B 在此排隊）
  │                           │                        │
  │                           │─ POST /auth/refresh    │
  │                           │  Cookie: refresh_token │
  │                           │  x-refresh-request: 1  │
  │                           │                        │
  │                           │◀─ 200 新 accessToken   │
  │                           │   Set-Cookie 新 refresh│
  │                           │                        │
  │                           │─ BroadcastChannel ────▶│ 「新 token 在這」
  │                           │─ 釋放鎖                │─ 拿到鎖時 token 已新鮮 → 直接採用
  │◀── accessToken ───────────│                        │
```

> **為什麼要跨分頁協調**：refresh token 是輪替的。兩個分頁同時拿同一個舊 token
> 去續期，第二個會被判定為「重用」，整條家族被撤銷，使用者被登出。
> Web Locks 讓同一瀏覽器的分頁依序續期，後一個拿到鎖時用的已經是新 cookie。

---

## 3. 登入

### 3.1 流程

```ts
async login(dto: LoginDto, ctx: RequestContext) {
  // ★ 漸進延遲（§3.4）：在 argon2 之前判斷，等待中的嘗試直接 429
  await this.loginThrottle.assertAllowed(tenant.id, dto.email, ipPrefix);
  const user = await this.userRepo.findByEmail(dto.email);

  // ★ 時序攻擊防護：帳號不存在時也跑一次 argon2，讓回應時間一致
  if (!user) {
    await argon2.verify(DUMMY_HASH, dto.password).catch(() => false);
    await this.loginThrottle.recordFailure(tenant.id, dto.email, ipPrefix);   // 不存在的 email 一樣計數
    await this.audit.loginFailure(dto.email, 'user_not_found', ctx);
    throw new AppException(ErrorCode.AUTH_INVALID_CREDENTIALS);
  }

  // ★ 先驗密碼，再看鎖定與狀態：不知道密碼的人只看得到 AUTH_INVALID_CREDENTIALS
  const ok = user.passwordHash
    ? await argon2.verify(user.passwordHash, dto.password)
    : await argon2.verify(DUMMY_HASH, dto.password).then(() => false);
  const locked = user.lockedUntil && user.lockedUntil > new Date();

  if (!ok) {
    await this.loginThrottle.recordFailure(tenant.id, dto.email, ipPrefix);
    if (locked) {}                                                // 鎖定中不計數、不延長
    else if (await this.loginSources.isKnown(user.id, ipPrefix)) await this.audit.loginFailure(user, 'known_source', ctx);
    else await this.registerFailedAttempt(user, ctx);             // 只有陌生來源累計鎖定（§3.4）
    throw new AppException(ErrorCode.AUTH_INVALID_CREDENTIALS);
  }

  // 鎖定中連密碼正確也不透露；密碼正確但不能登入的三種情況都寫失敗的稽核
  if (locked) {
    await this.audit.loginRejected(user, 'locked', ctx);
    throw new AppException(ErrorCode.AUTH_INVALID_CREDENTIALS);
  }
  if (user.status === 'pending') {
    await this.audit.loginRejected(user, 'pending', ctx);
    throw new AppException(ErrorCode.AUTH_ACCOUNT_PENDING);
  }
  if (user.status !== 'active') {
    await this.audit.loginRejected(user, 'disabled', ctx);
    throw new AppException(ErrorCode.AUTH_ACCOUNT_DISABLED);
  }

  await this.userRepo.update(user.id, {
    failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date(),
  });
  await this.loginThrottle.reset(tenant.id, dto.email, ipPrefix);
  await this.loginSources.remember(user.id, ipPrefix);
  await this.audit.loginSuccess(user, ctx);

  return this.issueSession(user, ctx);     // 新 family
}
```

### 3.2 帳號列舉防護

| 情況           | 回應                                                             |
| -------------- | ---------------------------------------------------------------- |
| 帳號不存在     | `AUTH_INVALID_CREDENTIALS`（跑 dummy hash 保持時間一致）         |
| 密碼錯誤       | `AUTH_INVALID_CREDENTIALS`                                       |
| 帳號未啟用（密碼正確） | `AUTH_ACCOUNT_PENDING` ← **刻意可區分**                  |
| 帳號停用（密碼正確）   | `AUTH_ACCOUNT_DISABLED` ← **刻意可區分**                 |
| 登入失敗鎖定中（不論密碼對錯） | `AUTH_INVALID_CREDENTIALS` ← **不可區分**        |
| 帳號未啟用、停用（密碼錯誤） | `AUTH_INVALID_CREDENTIALS`                         |

密碼錯誤時一律不可區分。鎖定中連密碼正確也不可區分：鎖定期間的嘗試不計數、不延長鎖定（避免知道 email 的人把人一直鎖死），
所以鎖定並不阻止繼續猜；若對正確密碼回另一個錯誤碼，就等於告訴猜密碼的人「這一個猜中了」。
密碼正確、但帳號鎖定中、未啟用或停用時都寫一筆 `auth.login.failure`（`metadata.credentialsValid: true`）：
帳號被鎖或停用之後還有人拿正確的密碼來試，是憑證外洩的強訊號。其餘狀態在密碼正確時才告知，因為使用者需要知道該怎麼辦——
這些分支都在驗證密碼 **之後**，只有知道密碼的人看得到，不能拿來列舉帳號
（還沒設定密碼的 `pending` 帳號對 dummy hash 驗證，一樣是 `AUTH_INVALID_CREDENTIALS`）。
「帳號不存在」與「帳號沒有密碼」都以 **實際設定的** `ARGON2_*` 參數算 dummy hash，耗時與真正的驗證一致。

### 3.3 鎖定

次數與時間是租戶的系統設定 `auth.loginMaxAttempts`（預設 5）、`auth.loginLockoutSeconds`（預設 900）
（[`12-settings.md`](./12-settings.md) §3）；平台管理者的鎖定仍讀 env `LOGIN_MAX_ATTEMPTS`、`LOGIN_LOCKOUT_SECONDS`。

```sql
-- UserRepository.recordFailedLogin：原子遞增，併發的錯誤密碼每一次都算數
UPDATE users SET
  failed_login_count = CASE WHEN <上次鎖定已到期> THEN 1 ELSE failed_login_count + 1 END,
  locked_until       = CASE WHEN <新的次數> >= $max THEN now() + $lockout ELSE NULL END
WHERE id = $1 AND (locked_until IS NULL OR locked_until <= now())   -- 鎖定中不更新
RETURNING failed_login_count, locked_until;
```

- **鎖定是輔助，猜測的防線是速率限制與漸進延遲**：「帳號 ＋ IP」與每 IP 兩個桶（[`03-api-conventions.md`](./03-api-conventions.md) §8）與 §3.4 的延遲在鎖定期間照常計數；
  鎖定只讓同一個帳號在鎖定期間不能登入，回應與密碼錯誤相同（§3.2）。
- **只有陌生來源的錯誤累計鎖定**：從已知來源（§3.4）打錯密碼只寫稽核（`metadata.reason: 'known_source'`），不增加 `failed_login_count`。
- **只寫 `locked_until`，不改 `status`**：鎖定是擋猜密碼，不撤銷既有 session、不推 `session.revoked`。
  否則任何知道 email 的人錯 5 次就能把線上的人（包括最後一位 super-admin）踢下線。API 對外顯示的狀態在
  `locked_until` 還沒到期時是 `locked`（`displayStatusOf`；列表以 `status=locked` 篩選的是 `status = active` 且 `locked_until` 還沒到期，與顯示一致），到期自動回到 `active`。
- **上次鎖定到期後從 1 重新計算**，到期後再錯一次不會立刻重鎖；鎖定中的錯誤密碼不計數、不延長鎖定。
- 外部 IdP 登入不受鎖定影響（外部 IdP 已驗過本人）。
- 舊版留下的 `status = 'locked'` 由 migration `0003` 改回 `active`（`locked_until` 保留）；之後由 CHECK 約束 `users_status_not_locked`（migration `0037`）擋住寫入，
  `locked` 只留在列舉裡給 DTO 與篩選用。
- 平台管理者用同一套原子計數（`PlatformAdminRepository.recordFailedLogin`）與「先驗密碼再看狀態」，同樣 **只寫 `locked_until`、不改 `status`**：
  平台管理者只有幾位、email 常猜得到，改 `status` 的話不需要任何帳號就能把所有平台管理者持續踢下線。
  管理介面顯示的 `locked` 由 `locked_until` 推出（`displayStatusOf`），super-admin 把它改成 `active` 即解鎖（清掉計數與到期時間）。
  舊版留下的 `status = 'locked'` 由平台 migration `0015` 改回 `active`。

解鎖途徑：

1. 等鎖定時間（預設 15 分鐘）過去，下次成功登入時計數與 `locked_until` 歸零
2. 「忘記密碼」→ 重設密碼（重設會順帶解鎖；鎖定中的人仍是 `active`，收得到重設信）
3. 管理員 `POST /users/:id/unlock`（需要 `user:update`）

### 3.4 漸進延遲與已知來源

**漸進延遲**（`core/rate-limit/login-throttle.ts` 的 `LoginThrottle`）：以「租戶 id（平台管理者是 `platform`）× email × IP 前綴（IPv4 完整位址、IPv6 /64）」
計 **15 分鐘內的密碼錯誤次數**——只算錯誤，不算請求。第 3 次錯誤之後，下一次嘗試要等 `2^(n−3)` 秒（1、2、4…，上限 60 秒）：

- 在查帳號與 argon2 **之前** 判斷，等待中的嘗試回 `429 RATE_LIMITED`（`details.retryAfterSeconds` 與 `Retry-After`），不消耗 argon2，也不計入鎖定。
  **伺服器不 sleep**：睡著的請求仍佔著連線。
- 訊息與一般限流相同，前端照樣倒數（不提示「帳號可能被鎖」），不透露這個帳號存在而且正在被延遲；不存在的 email 一樣計數。
- 成功登入清除。計數經過 `RateLimitStore`（[`03-api-conventions.md`](./03-api-conventions.md) §8），多實例時與限流一起換成共享的實作。
- 每分鐘 10 次的桶擋不住「每分鐘 9 次、持續一整天」；延遲讓單一來源的猜測成本指數成長，正常使用者打錯兩次不受影響。

**已知來源**：登入成功時記下「使用者 × IP 前綴」（租戶 DB `user_login_sources`、平台 DB `platform_admin_login_sources`，`last_success_at` 每次成功更新）。
30 天內成功登入過的來源是已知來源（`LOGIN_SOURCE_RETENTION_DAYS`），過期的列由每天的 `auth.tokenCleanup`／`auth.platformTokenCleanup` 分批清除。

- 已知來源的錯誤密碼 **不累計鎖定**，只受延遲限制；陌生來源的錯誤照 §3.3 累計。
- 解決「知道 email 就能鎖住別人」：受害者從平常的辦公室 IP 仍能登入；分散式撞庫（大量陌生 IP）仍會觸發鎖定。
- 代價：同一個 NAT 後面的內部人員打錯不會觸發鎖定，但仍受延遲與每分鐘 10 次的桶限制。
- 上線當下沒有任何已知來源，行為與之前相同；每個人成功登入一次之後才生效。
- 外部 IdP 登入不經過密碼驗證，不記錄來源。

**MFA 的第二步**（[`21-mfa.md`](21-mfa.md) §4.2）：驗證碼錯誤與密碼錯誤 **共用** 漸進延遲的計數與帳號的失敗次數（已知來源同樣不累計）。
所以「密碼通過」與「登入成功」分開：密碼檢查（`UserLoginService.verifyPassword`、`PlatformAdminService.verifyPassword`）不寫成功的副作用，
失敗計數歸零、記住來源、`auth.login.success` 稽核（帶 `amr`、`mfaMethod`）在第二步也通過之後才寫（`completeLogin`）——否則知道密碼的人每輸入一次密碼
就把第二步的失敗次數歸零，而且他的 IP 會變成已知來源。

### 3.5 端到端：從輸入帳密到首頁

錯誤碼的規則見 §3.2、§3.3；外部 IdP 與 apps/platform 的登入入口見 [`../04-sso.md`](../04-sso.md)。

```
使用者        apps/backstage                 apps/api                      DB
  │              │                        │                           │
  │─ 輸入帳密 ──▶│                        │                           │
  │              │─ POST /auth/login ────▶│                           │
  │              │                        │─ findByEmail(citext) ────▶│
  │              │                        │◀── user | null ───────────│
  │              │                        │                           │
  │              │                     ┌──┴─────────────────────────┐ │
  │              │                     │ 1. user 存在？             │ │
  │              │                     │ 2. locked_until > now？    │ │
  │              │                     │ 3. status = 'active'？     │ │
  │              │                     │ 4. argon2.verify(pw)？     │ │
  │              │                     └──┬─────────────────────────┘ │
  │              │                        │                           │
  │              │                    失敗 │─ failed_login_count+1 ──▶│
  │              │                        │  （達 5 次 → locked 15m） │
  │              │                        │─ audit(auth.login.failure)│
  │              │◀── 401 AUTH_INVALID ───│                           │
  │              │    （訊息不區分帳號不存在/密碼錯）                   │
  │              │                        │                           │
  │              │                    成功 │─ failed_login_count = 0 ▶│
  │              │                        │─ last_login_at = now ────▶│
  │              │                        │─ INSERT refresh_tokens ──▶│
  │              │                        │   (family_id = new uuid)  │
  │              │                        │─ audit(auth.login.success)│
  │              │◀── 200 + Set-Cookie ───│                           │
  │              │                        │                           │
  │              │─ SessionStore.setTokens(accessToken, expiresIn)     │
  │              │                        │                           │
  │              │─ GET /auth/profile ───▶│                           │
  │              │                        │─ 解析權限集合 ───────────▶│
  │              │◀── { user, roles, permissions[] } ─────────────────│
  │              │                        │                           │
  │              │─ usePermissionStore.setPermissions(permissions)     │
  │              │─ i18n.changeLanguage(user.preferences.locale)       │
  │              │─ navigate('/')                                      │
  │◀── 首頁 ─────│                        │                           │
```

**回應載荷**

```jsonc
// POST /auth/login → 200
{
  "data": {
    "accessToken": "eyJhbGciOi...",
    "tokenType": "Bearer",
    "expiresIn": 300,
  },
}
// Set-Cookie: refresh_token=<opaque>; HttpOnly; Secure; SameSite=Lax; Path=/api/auth; Max-Age=604800
```

```jsonc
// GET /auth/profile → 200
{
  "data": {
    "user": {
      "id": "0192...",
      "email": "admin@example.com",
      "displayName": "Admin",
      "status": "active",
      "preferences": { "locale": "zh-TW", "timezone": "Asia/Taipei" },
    },
    "roles": [{ "id": "...", "slug": "admin", "name": "系統管理員" }],
    "permissions": ["user:create", "user:read", "role:read", "..."],
  },
}
```

---

## 4. 密碼

### 4.1 雜湊

```ts
import * as argon2 from "@node-rs/argon2";

const OPTIONS = {
  algorithm: argon2.Algorithm.Argon2id,
  memoryCost: env.ARGON2_MEMORY_COST, // 19456 KiB = 19 MiB
  timeCost: env.ARGON2_TIME_COST, // 2
  parallelism: 1,
};
```

參數依 OWASP Password Storage Cheat Sheet 的 Argon2id 建議值。

所有雜湊與驗證（登入、帳號不存在時的假驗證、變更／重設／啟用密碼，租戶與平台管理者）都經過 `PasswordHasher`
（`modules/credential/password-hasher.ts`，全域的 `PasswordHasherModule`；平台管理者原本用預設參數，現在一樣讀 `ARGON2_*`）：

| 環境變數 | 預設 | 作用 |
| --- | --- | --- |
| `ARGON2_MAX_CONCURRENCY` | 4 | 同時執行的上限（每程序）。4 個約佔 76 MiB，留下 `UV_THREADPOOL_SIZE` 的其餘執行緒給 sharp、DNS、檔案 I/O |
| `ARGON2_MAX_QUEUE` | 32 | 等待中的上限；超過立刻回 `503 AUTH_BUSY` |
| `ARGON2_QUEUE_TIMEOUT_MS` | 3000 | 等待逾時；超過回 `503 AUTH_BUSY` |

argon2 跑在 libuv 的 threadpool，沒有上限時一陣登入尖峰會佔滿整個 threadpool，連帶拖慢影像處理與 webhook 的 DNS 查詢。
名額滿了快速失敗（`503 AUTH_BUSY`，`details.retryAfterSeconds = 2` 與 `Retry-After`），登入頁倒數後再試；單次驗證約 25–60 ms，
4 個並行仍有每秒數十次的吞吐，遠高於每租戶的登入上限（[`03-api-conventions.md`](./03-api-conventions.md) §8）。
限制器（`core/concurrency/limiter.ts`：FIFO、等待上限、逾時）與影像處理的並行上限共用。上限是 **每程序**，多實例時不共享。

### 4.2 強度要求

```ts
export const PasswordSchema = z
  .string()
  .min(12, "AUTH_PASSWORD_WEAK")
  .max(128)
  .refine((pw) => !COMMON_PASSWORDS.has(pw.toLowerCase()), "AUTH_PASSWORD_WEAK");
```

**只要求長度 ≥ 12 ＋ 不是常見密碼**，不要求「大小寫 + 數字 + 符號」。
複雜度規則已被證實會讓使用者選出更好猜的密碼（`Password1!`）。NIST SP 800-63B
也已移除該建議。

「常見密碼」（`isCommonPassword`）有兩層：

- **洩漏清單**（`common-password-list.ts`）：SecLists 的 `10k-most-common.txt`（MIT）轉小寫、去重、只留長度 ≥ 6 的約 7 700 筆。
  整串、去掉頭尾符號、去掉尾端的數字與符號、去掉頭尾非字母、把替換字元換回字母、只留字母——任一個版本 **完全等於** 清單裡的一筆就算常見
  （`Unbelievable`、`Jessica2026!!`、`M@tr1x2026!!`）。只比對長度 ≥ 6 的版本，避免剝成很短的片段後誤判。
  清單是產生出來的檔案，更新時照檔頭的規則重新產生，不手改。
- **字根**（`common-passwords.ts`）：洩漏清單裡長度 ≥ 12 的密碼幾乎都是「常見字根 ＋ 數字／年份／符號」或鍵盤排列，
  清單本身比對不到這些變形；去掉前後的數字與符號、把替換字元換回字母（`P@ssw0rd2026!` → `password`）後比對字根；
  整串是重複片段或鍵盤／字母順序也算。
需要脈絡的規則在 service（`assertPasswordPolicy`）：租戶的最短長度（`auth.passwordMinLength`），
以及密碼不能含 email 的帳號部分、網域名稱或租戶代碼（長度 ≥ 4 的片段）。錯誤形狀與 DTO 驗證相同
（`VALIDATION_FAILED`，`fields.<欄位> = AUTH_PASSWORD_WEAK`）。

### 4.3 變更密碼

```
POST /auth/change-password { currentPassword, newPassword }
  ├─ 驗證 currentPassword（錯 → AUTH_PASSWORD_MISMATCH）
  ├─ newPassword 強度檢查
  ├─ newPassword ≠ currentPassword
  ├─ 更新 password_hash
  ├─ ★ token_version += 1
  ├─ ★ 撤銷所有 refresh token（reason='password_reset'）
  │     ——包含當前這一條，使用者必須重新登入
  └─ audit(auth.password_change)
```

「變更密碼後其他裝置全部登出」是使用者預期的行為，也是密碼外洩時的補救手段。

---

## 5. 啟用與密碼重設

兩者共用 `auth_tokens` 表，差在 `purpose` 與有效期。

|          | 啟用（activation） | 密碼重設（password_reset）                     |
| -------- | ------------------ | ---------------------------------------------- |
| 建立時機 | 管理員建立使用者、核准註冊申請；`pending` 的人按「忘記密碼」或管理員按「重設密碼」＝重寄 | 使用者請求 / 管理員代觸發                      |
| 有效期   | 24 小時（設定 `auth.activationTtlHours`） | 1 小時（設定 `auth.passwordResetTtlHours`）     |
| 目標狀態 | `pending`          | `active`                                       |
| 完成後   | `status → active`（**只接受 `pending`**：被停用的人不能用手上的啟用信把自己改回 active） | `token_version += 1` ＋ 撤銷所有 refresh token |

- 消耗 token 是條件式的 `UPDATE … WHERE used_at IS NULL AND expires_at > now() RETURNING`，在寫入密碼的同一個交易裡：
  同一個連結被雙擊或兩個分頁同時送出，只有一個成功，另一個 `AUTH_SETUP_TOKEN_INVALID`。
- 停用、刪除帳號時，同一個交易內作廢這個人所有未使用的啟用／重設 token。
- `PATCH /users/:id` 不接受 `status: 'pending'`：改回 pending 的人沒有啟用 token，再也登入不了。

### 5.1 Token 本身

```ts
const raw = randomBytes(32).toString("base64url"); // 寄出去的
const hash = sha256(raw); // 入庫的
```

**資料庫裡只有雜湊。** 即使資料庫外洩，攻擊者也無法用其中的值重設任何人的密碼。

原文只存在於寄出的信裡：token 由寄信的背景工作在 **寄出當下** 簽發，不在入列時簽發，
所以工作資料與日誌都不會出現原文（[`11-mail.md`](./11-mail.md) §4、§5）。

發新 token 時先作廢同使用者同用途的既有未使用 token：

```sql
UPDATE auth_tokens SET used_at = now()
WHERE user_id = $1 AND purpose = $2 AND used_at IS NULL;
```

### 5.2 忘記密碼的列舉防護

```ts
@Post('forgot-password')
@Public()
async forgotPassword(@Body(...) dto: ForgotPasswordDto) {
  const user = await this.users.findAccountByEmail(dto.email);
  // active（含登入失敗鎖定中）→ 重設信；pending → 啟用信（自助重寄）；其他狀態不寄
  const job = user?.status === 'active' ? PASSWORD_RESET_MAIL_JOB
            : user?.status === 'pending' ? ACTIVATION_MAIL_JOB : undefined;
  if (user && job) {
    // 只入列：寄信在背景工作裡，回應時間不因帳號是否存在而不同；同帳號 60 秒內只入列一筆
    await this.jobs.enqueue(job, { userId: user.id }, { throttle: … });
  }
  // ★ 不論如何都回 200，且回應時間一致
  return { sent: true };
}
```

管理員建立帳號時，啟用信在建立帳號的交易內入列；管理員代為重設時，重設信與稽核在同一個交易內入列
（[`11-mail.md`](./11-mail.md) §4）。

### 5.3 流程總覽

兩條流程共用同一個 token 機制（單次使用、有期限、雜湊入庫）。

```
① 管理員建立使用者（status = pending，password_hash = NULL）
     └─ 產生 activation token（24h）→ 寄信
② 使用者點連結 {PLATFORM_APP_URL}/setup?token=xxx（apps/platform 的頁面，docs/architecture/04-sso.md §6.2）
     └─ GET  /auth/setup/verify?token=xxx   → 200 { email } | 400 TOKEN_INVALID
     └─ POST /auth/setup { token, password }
           ├─ 密碼強度檢查（≥ 租戶設定的長度 `auth.passwordMinLength`，至少 12 字元；非常見密碼）
           ├─ argon2 雜湊 → users.password_hash
           ├─ status: pending → active
           ├─ 標記 token 已使用
           └─ audit(user.activate)
③ 忘記密碼 /auth/forgot-password { email }
     └─ ★ 不論 email 是否存在都回 200（避免帳號列舉）
     └─ 存在且 active → 產生 reset token（1h）→ 寄信
④ POST /auth/reset-password { token, password }
     ├─ 同上驗證與雜湊
     ├─ ★ token_version + 1（重設密碼強制所有裝置登出）
     ├─ 撤銷所有 refresh token
     └─ audit(auth.password_reset)
```

---

## 6. `JwtAuthGuard`

`JwtAuthGuard`、WebSocket 的握手與 `session.renew` 都經過同一個 `AccessTokenVerifier`（`common/auth/access-token.verifier.ts`）：

```ts
async verify(token: string | undefined): Promise<AccessTokenVerifyResult> {
  const payload = await this.verifyClaims(token); // 驗簽 ＋ 身分範圍
  if (!payload) return { ok: false, code: 'AUTH_TOKEN_INVALID' };
  const checked = await this.checkUser(payload.sub, payload.ver); // 快取或 DB：deletedAt、status、token_version
  return checked.ok ? { ok: true, user: checked.user, payload } : checked;
}

async verifyClaims(token: string | undefined) {
  if (!token || token.startsWith(API_TOKEN_PREFIX)) return undefined; // API token 只在對外 API 有效
  const tenant = currentTenant();
  // 金鑰依網域選（§11 D4）：租戶網域只用租戶的金鑰環、apps/platform 只用平台的
  const payload = await this.keys.verify(tenant ? 'tenant' : 'platform', token);
  if (!payload) return undefined;
  // 身分範圍也由網域決定：租戶網域只接受那個租戶簽的 token，apps/platform 只接受平台管理者的
  const matches = tenant ? payload.tid === tenant.id : payload.realm === 'platform' && !payload.tid;
  return matches ? payload : undefined;
}
```

錯誤碼：驗不過（含金鑰、`kid`、身分範圍）→ `AUTH_TOKEN_INVALID`；帳號停用 → `AUTH_ACCOUNT_DISABLED`；`token_version` 不符 → `AUTH_TOKEN_STALE`。

`UserCacheService` TTL 30 秒，且在使用者被更新／停用／刪除時 **主動失效**。
快取的存在讓「每個請求都驗證使用者狀態」這件事的成本可以接受。

---

## 7. 登出

```ts
@Post('logout')
@Public()                 // bearer 可有可無（見下方）
@RateLimit('refresh')     // 以 refresh session 計數，不吃每人的一般額度
async logout(@Req() req, @Res({ passthrough: true }) res) {
  const result = await this.authService.logout({
    refreshToken: req.cookies[env.REFRESH_COOKIE_NAME],
    accessToken: extractBearer(req.headers.authorization),
    refreshRequested: req.header('x-refresh-request') === '1',
  });
  res.clearCookie(env.REFRESH_COOKIE_NAME, { path: env.REFRESH_COOKIE_PATH });
  return result;
}

// AuthService.logout
//   有 bearer → 照 JwtAuthGuard 的規則驗證（AccessTokenVerifier），撤銷 cookie 所在的家族，稽核記在 bearer 的主人名下
//   沒有 bearer → 要求 x-refresh-request: 1 與 refresh cookie（否則 401 AUTH_REFRESH_INVALID），以 cookie 找家族與主人；
//                 家族已撤銷也照樣結束 IdP session（上一次登出只完成一半時的重試）
```

**為什麼沒有 bearer 也能登出**：前端在登出前先等續期，續期暫時失敗（離線、5xx、429）時手上沒有 access token；
已登出頁的「重試登出」也沒有。只認 bearer 的話這兩種情況都撤銷不了，IdP session 留著，下一個人打開產品會被直接登入
（[`../04-sso.md`](../04-sso.md) §3.4）。CSRF 的緩解與 `/auth/refresh` 相同：跨站的表單送不出自訂標頭，帶了就會觸發 preflight。

**撤銷整條家族，而不只是當前這一條**：使用者按登出的意思是「結束這個裝置的
session」，而不是「作廢我手上這個 token 但留著它的後繼者」。

`token_version` **不** 遞增——登出只影響這個裝置，其他裝置的 session 應該保留。

前端的呼叫順序是「先結束前端 session、再打這個端點」，避免等待期間完成的續期
把已登出的頁面救活；見 [`../frontend/09-state-and-storage.md`](../frontend/09-state-and-storage.md) §5.2。

---

## 8. 清理排程

背景工作 `auth.tokenCleanup`（每個租戶）與 `auth.platformTokenCleanup`（平台管理者），依 `AUTH_TOKEN_CLEANUP_CRON`
（預設每天 04:15 UTC）執行，每批 5,000 列分批刪除（`auth-token-cleanup.jobs.ts`）：

- `refresh_tokens`：`expires_at` 早於 `now() − AUTH_TOKEN_RETENTION_DAYS`（預設 30 天）。只看到期時間：還沒到期的列
  （包括已使用、已撤銷的）要留著做重用偵測與家族撤銷的判斷。
- `auth_tokens`：到期或使用超過保留天數。

保留過期後 30 天，讓安全事件調查時還查得到「這個 token 什麼時候被用過」。每次續期都會新增一列，
不清的話表與索引一路膨脹、續期與登出越來越慢；家族的絕對壽命（§2.6）
讓單一家族的列數也有上限。


---

## 8.1 SSO（apps/api 當 OIDC Provider）

流程、端點、資料模型與部署見 [`../04-sso.md`](../04-sso.md)；決定與理由見 [`architecture/04-sso.md`](../04-sso.md) §12。這裡只列與本文件各節的關係。

- `modules/oidc-provider`：[`oidc-provider`](https://github.com/panva/node-oidc-provider) 掛在本程序的 `/oidc`（瀏覽器看到 `OIDC_ISSUER`，
  apps/platform origin 底下的 `/api/oidc`）；狀態存在 `oidc_payloads`，過期的列由背景工作 `oidc.cleanup` 清除。
- 登入互動（`AuthModule` 的 `SsoInteractionController`）：密碼檢查與 `POST /auth/login` 同一套（§3，`AuthService.verifyCredentials`）。
- 產品的 BFF（`POST /auth/sso/callback`）：在本程序內兌換授權碼後，照 §1、§2 發 app session，refresh token 多記 `client_id`、`idp_session_uid`；
  輪替時沿用。access token 帶 `sid`。
- 單一登出（§7 的延伸）：登出的家族有 `idp_session_uid` 時，銷毀 IdP session、撤銷同一個 IdP session 的所有家族（`revoked_reason = sso_logout`），
  並推播 `SESSIONS_REVOKED { idpSessionUids }`（[`08-realtime.md`](./08-realtime.md) §3.5）。
- 帳號停用、刪除、改密碼（`SESSIONS_REVOKED { userIds }`）時，這些人的 IdP session 一起結束（[`architecture/04-sso.md`](../04-sso.md) §12.2 D17）。
- 外部 IdP（`modules/identity-provider` ＋ `AuthModule` 的 `ExternalLoginService`，[`architecture/04-sso.md`](../04-sso.md) §12.2 D8–D11）：
  1. 互動頁以 email 查網域（`GET /oidc-interaction/:uid/discover`），`POST …/:uid/external` 回傳外部 IdP 的授權網址（PKCE、state、nonce 存在 `oidc_payloads`，10 分鐘）
  2. 外部 IdP 跳回固定的 `GET /oidc-interaction/external/callback`：兌換授權碼、驗 ID token（email 不在 ID token 時查 userinfo）、對應帳號，
     跳到 `…/:uid/external/complete?ticket=`；失敗時帶錯誤碼回到 apps/platform 的互動頁。這一步 **不拋例外**，任何錯誤都變成跳轉
  3. `complete` 帶得到互動 cookie：消耗 ticket、完成互動（`amr = ['ext']`），之後與密碼登入相同
  - 只允許 SSO 的網域（`identity_provider_domains.sso_only`）：`verifyCredentials` 在查帳號之前回 `AUTH_SSO_REQUIRED`（不洩漏帳號是否存在）；
    `forgotPassword` 不寄信（回應不變，§5.2）
  - client secret 以 `IDP_SECRET_KEY`（AES-256-GCM）加密；沒設時由 `JWT_SECRET` 以 HKDF 推導，只給開發用，production 必填
  - 以 email 自動連結既有帳號只在 email 網域登記在 **這個** 連線、且帳號沒有 `member` 以外的系統角色時進行，否則
    `AUTH_SSO_LINK_NOT_ALLOWED`（[`../04-sso.md`](../04-sso.md) §3.3）；修改連線的 issuer 或 client id 會刪除它所有的連結
  - production 下對外部 IdP 的每個請求（discovery、token、userinfo、JWKS）都先檢查目的地不是私有、loopback、link-local 位址，
    逾時 10 秒；discovery 快取以 secret 的雜湊為 key、有上限
  - 請求日誌的網址、解析好的 `query` 與 Referer 都遮掉 `code`、`state`、`ticket`、`code_verifier`、`id_token_hint`、`token`
    （`core/logger/redact.ts` 的 `SENSITIVE_QUERY_KEYS`，唯一的一份名單）

---

## 8.2 服務帳號與 API token

決定與理由見 [`architecture/06-external-api.md`](../06-external-api.md) §9。這一節是 **管理** 的部分：token 只在對外 API 有效，
內部 api（本文件 §6 的 `JwtAuthGuard`）不接受它（D10，`AccessTokenVerifier` 遇到 `b2bt_` 開頭直接拒絕）；
驗證、權限與 scopes 的交集、限流、`last_used_at` 見 [`../06-external-api.md`](../06-external-api.md)。

| 項目 | 做法 |
| --- | --- |
| 服務帳號 | `users.kind = 'service'`（[`02-database.md`](./02-database.md) §2.15）。`modules/service-account`：`/service-accounts`（`serviceAccount:*`）。建立、改角色的反提權與指派給人相同；持有 super-admin 的帳號只有 super-admin 能管理。停用與刪除遞增 `token_version`，它的 token 全部失效 |
| 個人 token | `modules/api-token`：`/auth/api-tokens`（`@Authenticated`，只管自己的）；管理者以 `user:update` 檢視、撤銷別人的（`/users/:userId/api-tokens`），不能替別人建立 |
| 服務帳號的 token | `/service-accounts/:id/tokens`：列出 `serviceAccount:read`，建立與撤銷 `serviceAccount:update` |
| 格式 | `b2bt_<租戶代碼>_<tokenId>_<secret>`（`api-token.format.ts`）；只在建立的回應出現一次，資料庫存 `SHA-256(secret)` |
| 失效 | `account_version ≠ token_version`（改密碼、被重設、強制登出、停用、刪除；§1.2）、`revoked_at`、`expires_at`。管理頁的 `status` 由這三者算出：`active`／`expired`／`revoked`／`invalidated` |
| 反提權（D4） | 替別人（服務帳號）建 token：token 取得的有效權限＝帳號的權限 ∩ scopes 的閉包，必須是操作者持有的；帳號是 super-admin 且沒有 scope 時操作者也要是 super-admin。只比對租戶層的權限鍵，資料夾等級不在 scope 裡（見 [`architecture/06-external-api.md`](../06-external-api.md) §9 實作紀錄） |
| 上限 | 到期天數依系統設定（[`12-settings.md`](./12-settings.md) §3），超過回 `400 API_TOKEN_LIFETIME_EXCEEDED`（`details.maxDays`）；一個帳號同時有效的 token 最多 50 把（`409 API_TOKEN_LIMIT_REACHED`） |
| 錯誤 | `404 SERVICE_ACCOUNT_NOT_FOUND`、`404 API_TOKEN_NOT_FOUND`；服務帳號的修改必帶 `version`（`409 SERVICE_ACCOUNT_VERSION_CONFLICT`），改角色帶 `expectedRoleIds`（別人已改過時 `409 SERVICE_ACCOUNT_ROLES_CONFLICT`） |
| 稽核 | `apiToken.create`、`apiToken.revoke`（`metadata.ownerId`、`ownerKind`、`prefix`）；`serviceAccount.create`／`update`／`assignRole`／`delete` |
| 管理畫面 | backstage 的 `features/service-account`（`/service-account`，詳情頁管角色與 token）；個人 token 在帳號設定（`/profile`）；使用者詳情頁在 `user:update` 時列出並可撤銷他的 token。三處共用 `core/components/ApiToken/`，明文只在建立成功的對話框顯示一次（[`iam/02-permission-catalog.md`](../iam/02-permission-catalog.md) §5） |
| 推播 | `serviceAccount`、`apiToken` 兩個來源（[`08-realtime.md`](./08-realtime.md) §6.1） |

**直接登入**（`POST /auth/login`，§3）：`DIRECT_LOGIN_ENABLED` 沒設定時 production 關閉（回 `404 NOT_FOUND`）、其他環境開啟。
它沒有 MFA 的第二步：已設定 MFA（或政策要求啟用）的帳號回 `403 AUTH_MFA_REQUIRED`（[`21-mfa.md`](21-mfa.md) §10）。
腳本改用 API token（D15）。登入互動（apps/platform）與 BFF 不受影響。

---

## 8.3 端點

圖例同 [`iam/04-api.md`](../iam/04-api.md)：🔓 `@Public`、🔑 `@Authenticated`、🛡 `@RequirePermissions`。

| Method | Path                    | 授權            | 說明                                |
| ------ | ----------------------- | --------------- | ----------------------------------- |
| POST   | `/auth/login`           | 🔓              | 帳密登入                            |
| POST   | `/auth/refresh`         | 🔓（靠 cookie） | 以 refresh token 續期               |
| POST   | `/auth/logout`          | 🔓（bearer 或 cookie） | 撤銷當前 refresh token 家族；沒有 bearer 時以 refresh cookie 認人（需 `x-refresh-request: 1`） |
| GET    | `/auth/profile`         | 🔑              | 取得自己的身分、角色與 **權限集合** |
| PATCH  | `/auth/profile`         | 🔑              | 修改自己的顯示名稱與偏好設定        |
| POST   | `/auth/change-password` | 🔑              | 變更自己的密碼（需提供舊密碼）      |
| POST   | `/auth/register`        | 🔓              | 送出註冊申請（需審批，永遠回 202）  |
| POST   | `/auth/forgot-password` | 🔓              | 請求密碼重設信                      |
| POST   | `/auth/reset-password`  | 🔓              | 以 reset token 設定新密碼           |
| GET    | `/auth/setup/verify`    | 🔓              | 驗證啟用 token 是否有效             |
| POST   | `/auth/setup`           | 🔓              | 以啟用 token 設定初始密碼           |

### 8.3.1 `POST /auth/login`

```jsonc
// Request
{ "email": "admin@example.com", "password": "••••••••" }

// 200
{
  "data": { "accessToken": "eyJ...", "tokenType": "Bearer", "expiresIn": 300 }
}
// + Set-Cookie: refresh_token=...; HttpOnly; Secure; SameSite=Lax; Path=/api/auth
```

速率限制：同 IP 每分鐘 10 次；同 email 連續 5 次失敗鎖定 15 分鐘。

### 8.3.2 `POST /auth/refresh`

必須帶自訂標頭 `x-refresh-request: 1`（CSRF 緩解）。回應同 login。

### 8.3.3 `GET /auth/profile`

```jsonc
// 200
{
  "data": {
    "user": {
      "id": "0192b...",
      "email": "admin@example.com",
      "username": "admin",
      "displayName": "系統管理員",
      "status": "active",
      "lastLoginAt": "2026-09-19T02:10:00.000Z",
      "preferences": { "locale": "zh-TW", "timezone": "Asia/Taipei" },
    },
    "roles": [{ "id": "...", "slug": "admin", "name": "系統管理員", "isSystem": true }],
    "permissions": ["user:create", "user:read", "role:read", "permission:read"],
  },
}
```

`permissions` 是 **扁平、已去重、已展開 super-admin、已套用權限依賴樹閉包**（[`iam/02-permission-catalog.md`](../iam/02-permission-catalog.md) §9）的字串陣列：
只被授予 `file:delete` 的人，這裡也會有 `file:update`、`file:read`、`file:access`。
前端 `usePermissionStore` 直接以此建立 `Set`。

### 8.3.4 `PATCH /auth/profile`

```jsonc
{ "displayName": "Willy", "preferences": { "locale": "en-US", "timezone": "UTC" } }
```

不可經此端點修改 `email` / `status` / 角色。

---

### 8.3.5 `POST /auth/register`

```jsonc
// Request
{ "email": "alice@example.com", "displayName": "Alice", "reason": "新進企劃" }

// 202 — 不論 email 是否已註冊或已在審核中，回應都相同（帳號列舉防護）
{ "data": { "submitted": true } }
```

- 租戶關閉了註冊（系統設定 `auth.registrationEnabled`）時回 `404 AUTH_REGISTRATION_DISABLED`。
- 不建立帳號，只建立一筆 `user.register` 審批請求；核准後建立 **未啟用**（`pending`）、沒有密碼的帳號並寄出啟用信，
  申請人從信中連結設定密碼（`POST /auth/setup`，套用租戶的 `auth.passwordMinLength`）後才能登入。
- 不收密碼：舊的用戶端仍送 `password` 時會被忽略，不保存。
- 速率限制：同一個 email ＋ IP 每分鐘 `max(3, AUTH_RATE_LIMIT / 3)` 次；同 IP 另有總上限（[`../architecture/backend/03-api-conventions.md`](./03-api-conventions.md) §8）。
- 流程與規則見 [`backend/20-approval.md`](./20-approval.md) §5。

---

## 9. 安全檢查清單

- [ ] Access token 壽命 ≤ 5 分鐘
- [ ] Access token 從不進入 `localStorage` / `sessionStorage`
- [ ] Refresh token 雜湊後入庫，明文只存在 cookie
- [ ] Refresh token 每次使用即輪替
- [ ] 重用偵測撤銷整條家族並寫入高嚴重度稽核
- [ ] Cookie 帶 `HttpOnly` + `Secure` + `SameSite=Lax` + `Path=/auth`
- [ ] `/auth/refresh` 要求 `x-refresh-request` 標頭
- [ ] 帳號不存在與密碼錯誤回應相同且耗時相近
- [ ] 忘記密碼永遠回 200
- [ ] 密碼用 Argon2id，參數符合 OWASP 建議
- [ ] 密碼強度只看長度與字典，不強制複雜度組合
- [ ] 變更 / 重設密碼會遞增 `token_version` 並撤銷所有 refresh token
- [ ] 停用 / 刪除使用者會遞增 `token_version` 並撤銷所有 refresh token
- [ ] 啟用 / 重設 token 雜湊後入庫，單次使用，有期限
- [ ] 登入端點有速率限制 ＋ 帳號鎖定（自動到期、原子計數、不踢既有 session）
- [ ] 狀態檢查在密碼驗證之後
- [ ] session 有絕對壽命；過期 token 有清理排程
- [ ] 所有認證事件都寫入稽核日誌

---

## 10. 設計決策：短期 JWT ＋ 輪替式 Refresh Token

> 原 ADR-0004，2026-09-19 決定。

### 10.1 背景

需要決定 session 的表示方式。三個常見選項：伺服器 session（cookie + 儲存）、
長期 JWT、短期 JWT ＋ refresh token。前端怎麼保存 token 見
[`../frontend/09-state-and-storage.md`](../frontend/09-state-and-storage.md)。

### 10.2 決定

- **Access Token**：JWT，5 分鐘，只存客戶端記憶體，內容只有 `{ sub, ver, jti }`
  （後來加上身分範圍 `tid`／`realm` 與 SSO 的 `sid`，見 §1.1；金鑰環與 `kid` 見 §11）
- **Refresh Token**：不透明隨機值，7 天，`httpOnly` cookie，
  雜湊後入庫，**每次使用即輪替**，**重用偵測 → 整條家族撤銷**
- **撤銷機制**：`users.token_version`，遞增即讓所有既存 access token 失效
- **跨分頁**：前端用 Web Locks（`navigator.locks`）互斥續期，確保同時只有一個分頁在輪替；
  `BroadcastChannel` 只負責分享新 token 與同步登出

### 10.3 理由

1. **Access token 不進 `localStorage`。** XSS 拿不到可長期使用的憑證。
   代價是重新整理頁面需要一次 refresh（約 50 ms）。
2. **Refresh token 是不透明值而非 JWT。** 它不需要攜帶資訊；換成 DB 查詢
   得到的是 **可撤銷性** 與 **重用偵測**，那是 JWT 做不到的。
3. **輪替 ＋ 家族撤銷是被竊取時的唯一補救。** 攻擊者用了偷來的 token，
   合法使用者下次續期就會觸發重用偵測；反之亦然。任一方先用都會讓整條家族失效。
4. **`token_version` 補上 JWT 的撤銷缺口。** 停用使用者、改密碼時遞增，
   既存 token 下一次請求即失效，不需要等 5 分鐘。
5. **5 分鐘是延遲與成本的平衡點。** 更短會讓續期請求變多；更長會拉大
   `token_version` 檢查之外的空窗（實際上有 `token_version` 就沒有空窗，
   5 分鐘只影響「快取的使用者狀態」的新鮮度）。

### 10.4 代價

| 代價 | 緩解 |
| --- | --- |
| **跨分頁必須協調**，否則會誤判為重用攻擊並登出使用者 | Web Locks 互斥（拿到鎖時 cookie 已是新的）；後端以條件式 `UPDATE` 保證同一張 token 只換發一次 |
| 每個請求都要驗簽 ＋ 查使用者狀態 | `UserCacheService` TTL 30 秒 |
| 重新整理頁面多一次往返 | 約 50 ms，可接受 |
| 實作複雜度高於伺服器 session | 這是主要代價；但重用偵測（§2.2）是伺服器 session 給不了的 |

### 10.5 替代方案

| 方案 | 不採用的理由 |
| --- | --- |
| 伺服器 session（cookie + DB/Redis） | 更簡單且天然可撤銷。但每個請求都要查 session store，且未來若要支援非瀏覽器客戶端（CLI、CI）需要另做一套 |
| 長期 JWT（無 refresh） | 無法撤銷。管理員停用一個帳號後那個人還能用到 token 過期 |
| Access token 帶權限 | 見 [`05-rbac.md`](./05-rbac.md) §11 |
| Refresh token 不輪替 | 被竊取後無從察覺 |
| Refresh token 存 `localStorage` | XSS 直接拿走長期憑證 |

## 11. 設計決策：access token 的金鑰環與用途分離

> 2026-10-07 決定（`hardening-followups.md` 設計決策 §1）。

### 11.1 背景

原本租戶與平台的 access token 都以同一把 HS256 `JWT_SECRET` 簽，縮圖網址的 HMAC 金鑰也由它推導，對外 API 的程序為了簽縮圖網址而持有它。
問題有三：輪替金鑰會讓所有人同時 401；租戶的 token 與平台的 token 只靠 claims 區分；對外入口被攻破時拿到的金鑰能偽造任何人（含平台管理者）的 token。

### 11.2 決定

| # | 決定 | 理由 |
| --- | --- | --- |
| D1 | **這一版不做每個租戶一把非對稱金鑰** | 簽發與驗證都在 api 程序；api 被攻破時不論金鑰怎麼存都拿得到所有租戶的金鑰，分開沒有隔離效果。觸發條件見 D6 |
| D2 | **金鑰環 ＋ `kid`**：`JWT_SIGNING_KEYS`＝`<kid>:<base64 金鑰>[,…]`，第一把簽發、全部都能驗證；簽發時 header 帶 `kid`，驗證依 `kid` 選金鑰，不認得的 `kid` 拒絕。`kid` 限 `[A-Za-z0-9_-]{1,32}`、不可重複；每把金鑰至少 32 bytes（`core/crypto/signing-keys.ts`） | 輪替＝在最前面加一把新的、部署，過一個 `JWT_ACCESS_TTL` 再刪掉舊的、部署，期間沒有人被迫重新登入；外洩時可以立刻拿掉 |
| D3 | **驗證固定 HS256**（`algorithms: ['HS256']`），金鑰依 `kid` 決定，不信任 token 自稱的 `alg` | 擋掉 `alg: none` 與演算法混淆；之後加入非對稱金鑰時也是以金鑰決定演算法 |
| D4 | **平台管理者用另一組金鑰環** `PLATFORM_JWT_SIGNING_KEYS`，不能與租戶的共用金鑰；租戶網域只用租戶的金鑰環驗、沒有租戶的網域只用平台的 | 縱深防禦：claims 的比對即使出錯，另一組金鑰簽的 token 也過不了驗簽 |
| D5 | **縮圖網址的金鑰獨立**：`FILE_URL_SIGNING_KEY`，簽章內容 `v2\n<tenantId>\n<fileId>\n<variant>\n<expiresAt>`、簽章值以 `v2.` 開頭（[`09-file.md`](./09-file.md) §5.4）。對外 API 的程序只拿到它，拿不到 access token 的金鑰（`AccessTokenKeys` 在對外的範圍不載入任何金鑰，`verifyClaims` 一律拒絕） | 對外入口被攻破時不能偽造 access token；網址帶租戶，換到別的租戶的網域直接驗不過 |
| D6 | **每租戶非對稱金鑰的觸發條件**（任一）：出現 api 程序以外、只需要驗證 token 的元件；客戶合約要求租戶專屬金鑰或自備金鑰；平台 realm 拆成獨立程序 | 三者都讓「簽的人」與「驗的人」分開，非對稱與分租戶才有實質效果。屆時 `kid` 已就位，token 格式不必再改 |
| D7 | **過渡期以 `JWT_SECRET` 驗證沒有 `kid` 的舊 token 與 v1 的縮圖網址**；production 的 `JWT_SECRET` 改為選填，過渡期（`JWT_ACCESS_TTL` ＋ `FILE_URL_TTL`，約一小時）之後從環境拿掉，舊格式就一律拒絕 | 升級的那次部署沒有人被登出；結束過渡期只改設定、不必再部署一次程式 |
| D8 | **開發與測試不必設定金鑰環**：沒設定時由 `JWT_SECRET` 以 HKDF 推導（每個用途不同：租戶、平台、縮圖網址）；production 一律要明確設定 | `.env.example` 維持一個值就能跑；推導出的金鑰不是 `JWT_SECRET` 本身，租戶與平台的金鑰也不同 |

### 11.3 代價

| 代價 | 緩解 |
| --- | --- |
| 部署多三個必填的秘密 | `deploy/prod.env.example` 附產生方式；`deploy/fake-prod-env.mjs`、`prod-compose-env.spec.ts` 檢查 compose 的形狀 |
| 輪替要部署兩次 | 與其他金鑰（`OIDC_JWKS`、`OIDC_COOKIE_KEYS`）相同的流程 |

### 11.4 評估過的方案

| 方案 | 結論 |
| --- | --- |
| 維持單一 HS256 金鑰 | 不採用：輪替造成 refresh 尖峰；對外 API 持有能偽造所有 token 的金鑰 |
| 每租戶 ES256 金鑰（平台 DB 存加密的私鑰、`TenantDirectory` 快取公鑰、背景工作輪替、JWKS 端點） | 延後到 D6 的條件成立 |
| 每租戶 HMAC 金鑰（由主金鑰以 HKDF 推導） | 不採用：主金鑰外洩等於全部外洩，只是看起來分開 |
| 加 `iss`／`aud` claims | 不採用：`tid`／`realm` 已表達受眾 |

---

## 12. 設計決策：登入的容量與速率限制第二版

> 2026-10-07 決定（`hardening-followups.md` 設計決策 §3）。共享計數（多實例時上限不變成 N 倍）是 [`../../features/multi-instance.md`](../../features/multi-instance.md) 的範圍；這裡定的是計數什麼、怎麼反應，兩者以 D1 的介面銜接。

### 12.1 決定

| # | 決定 | 理由 |
| --- | --- | --- |
| D1 | **計數介面 `RateLimitStore`**（`core/rate-limit/`）：`hit(key, windowMs) → { count, resetAt, lastAt }`、`peek(key)`、`reset(key)`；先以記憶體實作（`MemoryRateLimitStore`），全域 guard 不再依賴 `@nestjs/throttler` 的 storage | 第二版不必等多實例；多實例也不必重寫規則。鎖定（`locked_until`）與 D3 的已知來源本來就在 DB，多實例下天生共享 |
| D2 | **「帳號 × IP」漸進延遲**（§3.4）：15 分鐘內第 3 次錯誤之後等 `2^(n−3)` 秒（上限 60），回 429、伺服器不 sleep，成功清除，未知的 email 一樣計數 | 延遲讓單一來源的猜測成本指數成長；不 sleep 是因為睡著的請求仍佔著連線 |
| D3 | **已知來源不觸發鎖定**（§3.4）：`user_login_sources`／`platform_admin_login_sources`，保留 30 天，每天清理 | 知道 email 的人不能把別人鎖住；分散式撞庫仍會觸發鎖定 |
| D4 | **每租戶的登入上限**：`auth` 政策的租戶桶，預設 `AUTH_TENANT_RATE_LIMIT` = 1200/分（平台登入另一個桶），平台以 feature 參數 `rateLimit.authPerMinute` 覆寫（[`../05-tenancy.md`](../05-tenancy.md) §13） | 一個租戶被攻擊時，攻擊流量與它消耗的 argon2 不拖垮其他租戶的登入 |
| D5 | **IP 白名單是放寬不是豁免**：feature 參數 `rateLimit.trustedCidrs` 讓 `auth`／`authMail` 的 IP 桶 ×10，帳號桶、延遲、租戶桶不變；全平台的 `RATE_LIMIT_EXEMPT_CIDRS` 只給監控與內部服務，豁免以 IP 計的桶 | 企業 NAT 後面整間公司共用一個 IP；帳號層級的保護沒有理由因來源可信而拿掉。由平台設定：放寬會消耗共用的容量 |
| D6 | **argon2 的並行上限**：所有 hash／verify 經過 `PasswordHasher`（§4.1 的 `ARGON2_MAX_CONCURRENCY`／`ARGON2_MAX_QUEUE`／`ARGON2_QUEUE_TIMEOUT_MS`），滿了回 `503 AUTH_BUSY` ＋ `Retry-After` | 快速失敗比在 threadpool 裡無限排隊好；上限是每程序（CPU 是每台機器的資源） |
| D7 | **前端**：登入表單遇到 `429`／`503 AUTH_BUSY` 時以 `retryAfterSeconds` 倒數並停用送出鈕；延遲不額外提示 | 不洩漏「這個帳號存在而且正在被延遲」 |
| D8 | **與 multi-instance 的銜接**：所有計數都經過 D1；N 個實例而還沒換共享實作時，上限實際是 N 倍（[`03-api-conventions.md`](./03-api-conventions.md) §8）。寫入量：延遲只在密碼錯誤時寫、已知來源每次成功登入一次 upsert | 讓 multi-instance 評估 Postgres 計數時有明確的寫入量依據 |

### 12.2 評估過的方案

| 方案 | 結論 |
| --- | --- |
| 伺服器端 sleep 做延遲 | 不採用：見 D2 |
| CAPTCHA 取代延遲 | 不採用：要引入第三方服務；通用後台的使用者多半在公司網路，延遲已足夠。之後若要做，掛在「延遲超過 N 秒」之後 |
| 裝置 cookie（記住瀏覽器）取代 IP 前綴當已知來源 | 這一版不採用：登入在 apps/platform 的 OIDC 互動裡，cookie 要跨網域傳遞與輪替；之後與 MFA 的「記住這台裝置」（[`21-mfa.md`](21-mfa.md) 範圍外）一起做 |
| argon2 每租戶各自一個佇列（公平排程） | 不採用：D4 的租戶桶已限制單一租戶能送進來的量 |
| 降低 argon2 參數換吞吐 | 不採用：參數是密碼強度的決定（§4.1），不該被容量問題綁架 |
| 租戶管理者自己設定 IP 白名單 | 不採用：放寬會消耗全平台共用的容量，由平台管理者決定 |
