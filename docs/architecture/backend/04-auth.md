# 後端 04 — 認證

> 授權（誰能做什麼）見 [`05-rbac.md`](./05-rbac.md)。本章只談「你是誰」。

## 1. Token 策略

|                | Access Token                  | Refresh Token                      |
| -------------- | ----------------------------- | ---------------------------------- |
| 格式           | JWT（HS256）                  | 不透明隨機值（32 bytes base64url） |
| 壽命           | **5 分鐘**                    | **7 天**；家族（一次登入）最長 **30 天**（§2.6） |
| 存放（客戶端） | **記憶體**（JS 閉包）         | `httpOnly` cookie                  |
| 存放（伺服器） | 不存                          | SHA-256 雜湊後存 `refresh_tokens`  |
| 內容           | `{ sub, ver, jti, tid, iat, exp }`；經 SSO 登入時多 `sid`（IdP session） | 無語意；經 SSO 發出時記 `client_id`、`idp_session_uid` |
| 輪替           | 不適用                        | **每次使用即輪替**                 |
| 撤銷           | 靠 `token_version` 比對       | DB 標記 `revoked_at`               |

### 1.1 為什麼 access token 不帶權限

JWT 一旦簽出就無法撤回其內容。若權限寫在 token 裡，管理員移除某人的權限後，
那個人手上的 token 在到期前仍然有效——5 分鐘的安全空窗。

改成每次請求查詢權限集合（有快取），換來「權限變更立即生效」。
代價是一次快取查詢（命中時 < 1 ms）。詳見
[ADR-0005](../../adr/0005-permission-resolved-server-side.md)。

Token 裡因此只有這幾樣東西：

- `sub` — 使用者 ID
- `ver` — 簽發時的 `users.token_version`
- `jti` — 供稽核追蹤
- `tid` — 簽發時的租戶 id（[ADR-0020](../../adr/0020-physical-tenant-isolation.md) D10）：使用者 id 只在自己的租戶 DB 有意義，
  驗證時 `tid` 必須等於請求網域決定的租戶，否則 `AUTH_TOKEN_INVALID`，不會拿去查別的租戶的使用者

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

`/auth/refresh` 是唯一靠 cookie 認證的端點，因此是唯一的 CSRF 標的。防護：

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

---

## 3. 登入

### 3.1 流程

```ts
async login(dto: LoginDto, ctx: RequestContext) {
  const user = await this.userRepo.findByEmail(dto.email);

  // ★ 時序攻擊防護：帳號不存在時也跑一次 argon2，讓回應時間一致
  if (!user) {
    await argon2.verify(DUMMY_HASH, dto.password).catch(() => false);
    await this.audit.loginFailure(dto.email, 'user_not_found', ctx);
    throw new AppException(ErrorCode.AUTH_INVALID_CREDENTIALS);
  }

  // ★ 先驗密碼，再看鎖定與狀態：不知道密碼的人只看得到 AUTH_INVALID_CREDENTIALS
  const ok = user.passwordHash
    ? await argon2.verify(user.passwordHash, dto.password)
    : await argon2.verify(DUMMY_HASH, dto.password).then(() => false);
  const locked = user.lockedUntil && user.lockedUntil > new Date();

  if (!ok) {
    if (!locked) await this.registerFailedAttempt(user, ctx);   // 鎖定中不計數、不延長
    throw new AppException(ErrorCode.AUTH_INVALID_CREDENTIALS);
  }

  if (locked) {
    throw new AppException(ErrorCode.AUTH_ACCOUNT_LOCKED, {
      retryAfterSeconds: Math.ceil((+user.lockedUntil - Date.now()) / 1000),
    });
  }
  if (user.status === 'pending')  throw new AppException(ErrorCode.AUTH_ACCOUNT_PENDING);
  if (user.status !== 'active')   throw new AppException(ErrorCode.AUTH_ACCOUNT_DISABLED);

  await this.userRepo.update(user.id, {
    failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date(),
  });
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
| 帳號停用／鎖定（密碼正確） | `AUTH_ACCOUNT_DISABLED` / `AUTH_ACCOUNT_LOCKED` ← **刻意可區分** |
| 帳號未啟用、停用、鎖定（密碼錯誤） | `AUTH_INVALID_CREDENTIALS`                    |

密碼錯誤時一律不可區分。密碼正確時才告知狀態，因為使用者需要知道該怎麼辦——
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

- **只寫 `locked_until`，不改 `status`**：鎖定是擋猜密碼，不撤銷既有 session、不推 `session.revoked`。
  否則任何知道 email 的人錯 5 次就能把線上的人（包括最後一位 super-admin）踢下線。API 對外顯示的狀態在
  `locked_until` 還沒到期時是 `locked`（`displayStatusOf`；列表以 `status=locked` 篩選也看 `locked_until`），到期自動回到 `active`。
- **上次鎖定到期後從 1 重新計算**，到期後再錯一次不會立刻重鎖；鎖定中的錯誤密碼不計數、不延長鎖定。
- 外部 IdP 登入不受鎖定影響（外部 IdP 已驗過本人）。
- 舊版留下的 `status = 'locked'` 由 migration `0003` 改回 `active`（`locked_until` 保留）。
- 平台管理者用同一套原子計數（`PlatformAdminRepository.recordFailedLogin`）與「先驗密碼再看狀態」；
  平台管理介面以 `status = locked` 顯示與解鎖，所以平台管理者的鎖定仍會寫 `status`。

解鎖途徑：

1. 等鎖定時間（預設 15 分鐘）過去，下次成功登入時計數與 `locked_until` 歸零
2. 「忘記密碼」→ 重設密碼（重設會順帶解鎖；鎖定中的人仍是 `active`，收得到重設信）
3. 管理員 `POST /users/:id/unlock`（需要 `user:update`）

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

「常見密碼」（`isCommonPassword`）：洩漏清單裡長度 ≥ 12 的密碼幾乎都是「常見字根 ＋ 數字／年份／符號」或鍵盤排列，
所以不放上萬筆的清單，而是列字根（`common-passwords.ts`），去掉前後的數字與符號、把替換字元換回字母
（`P@ssw0rd2026!` → `password`）後比對；整串是重複片段或鍵盤／字母順序也算。
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

---

## 6. `JwtAuthGuard`

```ts
@Injectable()
export class JwtAuthGuard implements CanActivate {
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()])) {
      return true;
    }

    const req = ctx.switchToHttp().getRequest();
    const token = extractBearer(req.headers.authorization);
    if (!token) throw new AppException(ErrorCode.AUTH_TOKEN_INVALID);

    let payload: AccessTokenPayload;
    try {
      payload = await this.jwt.verifyAsync(token, { secret: env.JWT_SECRET });
    } catch {
      throw new AppException(ErrorCode.AUTH_TOKEN_INVALID);
    }

    // 短 TTL 快取：避免每個請求都查 users
    const user = await this.userCache.get(payload.sub);
    if (!user || user.deletedAt) throw new AppException(ErrorCode.AUTH_TOKEN_INVALID);
    if (user.status !== "active") throw new AppException(ErrorCode.AUTH_ACCOUNT_DISABLED);
    if (user.tokenVersion !== payload.ver) throw new AppException(ErrorCode.AUTH_TOKEN_STALE);

    req.user = { id: user.id, email: user.email, status: user.status };
    return true;
  }
}
```

`UserCacheService` TTL 30 秒，且在使用者被更新／停用／刪除時 **主動失效**。
快取的存在讓「每個請求都驗證使用者狀態」這件事的成本可以接受。

---

## 7. 登出

```ts
@Post('logout')
@Authenticated()
async logout(@Req() req, @Res({ passthrough: true }) res) {
  const raw = req.cookies[env.REFRESH_COOKIE_NAME];
  if (raw) {
    const row = await this.tokenRepo.findByHash(sha256(raw));
    if (row) await this.tokenRepo.revokeFamily(row.familyId, 'logout');
  }
  res.clearCookie(env.REFRESH_COOKIE_NAME, { path: '/auth' });
  await this.audit.record({ action: 'auth.logout', result: 'success', ... });
  return { success: true };
}
```

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

流程、端點、資料模型與部署見 [`../04-sso.md`](../04-sso.md)；決定與理由見 [ADR-0019](../../adr/0019-sso-identity-platform.md)。這裡只列與本文件各節的關係。

- `modules/oidc-provider`：[`oidc-provider`](https://github.com/panva/node-oidc-provider) 掛在本程序的 `/oidc`（瀏覽器看到 `OIDC_ISSUER`，
  apps/auth origin 底下的 `/api/oidc`）；狀態存在 `oidc_payloads`，過期的列由背景工作 `oidc.cleanup` 清除。
- 登入互動（`AuthModule` 的 `SsoInteractionController`）：密碼檢查與 `POST /auth/login` 同一套（§3，`AuthService.verifyCredentials`）。
- 產品的 BFF（`POST /auth/sso/callback`）：在本程序內兌換授權碼後，照 §1、§2 發 app session，refresh token 多記 `client_id`、`idp_session_uid`；
  輪替時沿用。access token 帶 `sid`。
- 單一登出（§7 的延伸）：登出的家族有 `idp_session_uid` 時，銷毀 IdP session、撤銷同一個 IdP session 的所有家族（`revoked_reason = sso_logout`），
  並推播 `SESSIONS_REVOKED { idpSessionUids }`（[`08-realtime.md`](./08-realtime.md) §3.5）。
- 帳號停用、刪除、改密碼（`SESSIONS_REVOKED { userIds }`）時，這些人的 IdP session 一起結束（ADR-0019 D17）。
- 外部 IdP（`modules/identity-provider` ＋ `AuthModule` 的 `ExternalLoginService`，ADR-0019 D8–D11）：
  1. 互動頁以 email 查網域（`GET /oidc-interaction/:uid/discover`），`POST …/:uid/external` 回傳外部 IdP 的授權網址（PKCE、state、nonce 存在 `oidc_payloads`，10 分鐘）
  2. 外部 IdP 跳回固定的 `GET /oidc-interaction/external/callback`：兌換授權碼、驗 ID token（email 不在 ID token 時查 userinfo）、對應帳號，
     跳到 `…/:uid/external/complete?ticket=`；失敗時帶錯誤碼回到 apps/auth 的互動頁。這一步 **不拋例外**，任何錯誤都變成跳轉
  3. `complete` 帶得到互動 cookie：消耗 ticket、完成互動（`amr = ['ext']`），之後與密碼登入相同
  - 只允許 SSO 的網域（`identity_provider_domains.sso_only`）：`verifyCredentials` 在查帳號之前回 `AUTH_SSO_REQUIRED`（不洩漏帳號是否存在）；
    `forgotPassword` 不寄信（回應不變，§5.2）
  - client secret 以 `IDP_SECRET_KEY`（AES-256-GCM）加密；沒設時由 `JWT_SECRET` 以 HKDF 推導，只給開發用，production 必填
  - 以 email 自動連結既有帳號只在 email 網域登記在 **這個** 連線、且帳號沒有 `member` 以外的系統角色時進行，否則
    `AUTH_SSO_LINK_NOT_ALLOWED`（[`../04-sso.md`](../04-sso.md) §3.3）；修改連線的 issuer 或 client id 會刪除它所有的連結
  - production 下對外部 IdP 的每個請求（discovery、token、userinfo、JWKS）都先檢查目的地不是私有、loopback、link-local 位址，
    逾時 10 秒；discovery 快取以 secret 的雜湊為 key、有上限
  - 日誌遮掉網址裡的 `code`、`state`、`ticket`、`code_verifier`、`id_token_hint`、`token`（`core/logger/redact.ts`）

---

## 8.2 服務帳號與 API token

決定與理由見 [ADR-0027](../../adr/0027-api-tokens-external-api.md)。這一節是 **管理** 的部分：token 只在對外 API 有效，
內部 api（本文件 §6 的 `JwtAuthGuard`）不接受它（D10，`AccessTokenVerifier` 遇到 `b2bt_` 開頭直接拒絕）；
驗證、權限與 scopes 的交集、限流、`last_used_at` 見 [`../06-external-api.md`](../06-external-api.md)。

| 項目 | 做法 |
| --- | --- |
| 服務帳號 | `users.kind = 'service'`（[`02-database.md`](./02-database.md) §2.15）。`modules/service-account`：`/service-accounts`（`serviceAccount:*`）。建立、改角色的反提權與指派給人相同；持有 super-admin 的帳號只有 super-admin 能管理。停用與刪除遞增 `token_version`，它的 token 全部失效 |
| 個人 token | `modules/api-token`：`/auth/api-tokens`（`@Authenticated`，只管自己的）；管理者以 `user:update` 檢視、撤銷別人的（`/users/:userId/api-tokens`），不能替別人建立 |
| 服務帳號的 token | `/service-accounts/:id/tokens`：列出 `serviceAccount:read`，建立與撤銷 `serviceAccount:update` |
| 格式 | `b2bt_<租戶代碼>_<tokenId>_<secret>`（`api-token.format.ts`）；只在建立的回應出現一次，資料庫存 `SHA-256(secret)` |
| 失效 | `account_version ≠ token_version`（改密碼、被重設、強制登出、停用、刪除；§1.2）、`revoked_at`、`expires_at`。管理頁的 `status` 由這三者算出：`active`／`expired`／`revoked`／`invalidated` |
| 反提權（D4） | 替別人（服務帳號）建 token：token 取得的有效權限＝帳號的權限 ∩ scopes 的閉包，必須是操作者持有的；帳號是 super-admin 且沒有 scope 時操作者也要是 super-admin。只比對租戶層的權限鍵，資料夾等級不在 scope 裡（見 ADR-0027 實作紀錄） |
| 上限 | 到期天數依系統設定（[`12-settings.md`](./12-settings.md) §3）；一個帳號同時有效的 token 最多 50 把（`API_TOKEN_LIMIT_REACHED`） |
| 稽核 | `apiToken.create`、`apiToken.revoke`（`metadata.ownerId`、`ownerKind`、`prefix`）；`serviceAccount.create`／`update`／`assignRole`／`delete` |

**直接登入**（`POST /auth/login`，§3）：`DIRECT_LOGIN_ENABLED` 沒設定時 production 關閉（回 `404 NOT_FOUND`）、其他環境開啟。
腳本改用 API token（D15）。登入互動（apps/auth）與 BFF 不受影響。

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
