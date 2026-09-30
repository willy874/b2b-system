# 後端 04 — 認證

> 授權（誰能做什麼）見 [`05-rbac.md`](./05-rbac.md)。本章只談「你是誰」。

## 1. Token 策略

|                | Access Token                  | Refresh Token                      |
| -------------- | ----------------------------- | ---------------------------------- |
| 格式           | JWT（HS256）                  | 不透明隨機值（32 bytes base64url） |
| 壽命           | **5 分鐘**                    | **7 天**                           |
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

兩種情況都當成攻擊處理：

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
為單位，所以「家族裡有任一列已撤銷」就等於整個家族已失效。

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

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    throw new AppException(ErrorCode.AUTH_ACCOUNT_LOCKED, {
      retryAfterSeconds: Math.ceil((+user.lockedUntil - Date.now()) / 1000),
    });
  }

  if (user.status === 'pending')  throw new AppException(ErrorCode.AUTH_ACCOUNT_PENDING);
  if (user.status !== 'active')   throw new AppException(ErrorCode.AUTH_ACCOUNT_DISABLED);

  const ok = user.passwordHash
    ? await argon2.verify(user.passwordHash, dto.password)
    : false;

  if (!ok) {
    await this.registerFailedAttempt(user, ctx);
    throw new AppException(ErrorCode.AUTH_INVALID_CREDENTIALS);
  }

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
| 帳號未啟用     | `AUTH_ACCOUNT_PENDING` ← **刻意可區分**                          |
| 帳號停用／鎖定 | `AUTH_ACCOUNT_DISABLED` / `AUTH_ACCOUNT_LOCKED` ← **刻意可區分** |

前兩者必須不可區分。後三者刻意可區分，因為使用者需要知道該怎麼辦——而且能走到
那些分支代表密碼已經驗過或帳號已知存在，隱藏沒有意義。

### 3.3 鎖定

次數與時間是租戶的系統設定 `auth.loginMaxAttempts`（預設 5）、`auth.loginLockoutSeconds`（預設 900）
（[`12-settings.md`](./12-settings.md) §3）；平台管理者的鎖定仍讀 env `LOGIN_MAX_ATTEMPTS`、`LOGIN_LOCKOUT_SECONDS`。

```ts
private async registerFailedAttempt(user: User, ctx: RequestContext) {
  const count = user.failedLoginCount + 1;
  const shouldLock = count >= (await this.settings.get(LOGIN_MAX_ATTEMPTS_SETTING));
  await this.userRepo.update(user.id, {
    failedLoginCount: count,
    lockedUntil: shouldLock
      ? addSeconds(new Date(), await this.settings.get(LOGIN_LOCKOUT_SECONDS_SETTING))
      : null,
    status: shouldLock ? 'locked' : user.status,
  });
  await this.audit.loginFailure(user.email, shouldLock ? 'locked' : 'bad_password', ctx);
}
```

解鎖途徑：

1. 等鎖定時間（預設 15 分鐘）過去（下次成功登入時 `status` 回到 `active`）
2. 管理員 `POST /users/:id/unlock`（需要 `user:update`）

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

**只要求長度 ≥ 12 ＋ 不在常見密碼字典中**，不要求「大小寫 + 數字 + 符號」。
複雜度規則已被證實會讓使用者選出更好猜的密碼（`Password1!`）。NIST SP 800-63B
也已移除該建議。

字典用 `top-10k-passwords` 之類的清單，啟動時載入成 `Set`。

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
| 建立時機 | 管理員建立使用者   | 使用者請求 / 管理員代觸發                      |
| 有效期   | 24 小時（設定 `auth.activationTtlHours`） | 1 小時（設定 `auth.passwordResetTtlHours`）     |
| 目標狀態 | `pending`          | `active`                                       |
| 完成後   | `status → active`  | `token_version += 1` ＋ 撤銷所有 refresh token |

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
  if (user && user.status === 'active') {
    // 只入列：寄信在背景工作裡，回應時間不因帳號是否存在而不同；同帳號 60 秒內只入列一筆
    await this.jobs.enqueue(PASSWORD_RESET_MAIL_JOB, { userId: user.id }, { throttle: … });
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

```ts
@Cron('0 3 * * *')     // 每天 03:00
async cleanupExpiredTokens() {
  const cutoff = subDays(new Date(), 30);
  await this.db.delete(refreshTokens).where(lt(refreshTokens.expiresAt, cutoff));
  await this.db.delete(authTokens).where(lt(authTokens.expiresAt, cutoff));
}
```

保留過期後 30 天，讓安全事件調查時還查得到「這個 token 什麼時候被用過」。


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
- [ ] 登入端點有速率限制 ＋ 帳號鎖定
- [ ] 所有認證事件都寫入稽核日誌
