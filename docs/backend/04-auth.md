# 後端 04 — 認證

> 授權（誰能做什麼）見 [`05-rbac.md`](./05-rbac.md)。本章只談「你是誰」。

## 1. Token 策略

|                | Access Token                  | Refresh Token                      |
| -------------- | ----------------------------- | ---------------------------------- |
| 格式           | JWT（HS256）                  | 不透明隨機值（32 bytes base64url） |
| 壽命           | **5 分鐘**                    | **7 天**                           |
| 存放（客戶端） | **記憶體**（JS 閉包）         | `httpOnly` cookie                  |
| 存放（伺服器） | 不存                          | SHA-256 雜湊後存 `refresh_tokens`  |
| 內容           | `{ sub, ver, jti, iat, exp }` | 無語意                             |
| 輪替           | 不適用                        | **每次使用即輪替**                 |
| 撤銷           | 靠 `token_version` 比對       | DB 標記 `revoked_at`               |

### 1.1 為什麼 access token 不帶權限

JWT 一旦簽出就無法撤回其內容。若權限寫在 token 裡，管理員移除某人的權限後，
那個人手上的 token 在到期前仍然有效——5 分鐘的安全空窗。

改成每次請求查詢權限集合（有快取），換來「權限變更立即生效」。
代價是一次快取查詢（命中時 < 1 ms）。詳見
[ADR-0005](../adr/0005-permission-resolved-server-side.md)。

Token 裡因此只有三樣東西：

- `sub` — 使用者 ID
- `ver` — 簽發時的 `users.token_version`
- `jti` — 供稽核追蹤

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

> 這就是為什麼前端的跨分頁單飛（`BroadcastChannel`）不是最佳化，而是 **必要**。
> 見 [`../frontend/09-state-and-storage.md`](../frontend/09-state-and-storage.md) §5.1。

### 2.3 完整判定

```ts
async refresh(rawToken: string, ctx: RequestContext) {
  const hash = sha256(rawToken);
  const row = await this.tokenRepo.findByHash(hash);

  if (!row)                        throw new AppException(ErrorCode.AUTH_REFRESH_INVALID);
  if (row.revokedAt)               throw new AppException(ErrorCode.AUTH_REFRESH_REVOKED);
  if (row.expiresAt < new Date())  throw new AppException(ErrorCode.AUTH_REFRESH_EXPIRED);

  if (row.usedAt) {
    await this.tokenRepo.revokeFamily(row.familyId, 'reuse_detected');
    await this.audit.record({
      action: 'auth.refresh.reuse_detected', result: 'failure',
      actorId: row.userId, resourceType: 'auth', metadata: { familyId: row.familyId, ...ctx },
    });
    throw new AppException(ErrorCode.AUTH_REFRESH_REUSED);
  }

  const user = await this.userRepo.findById(row.userId);
  if (!user || user.deletedAt)     throw new AppException(ErrorCode.AUTH_REFRESH_INVALID);
  if (user.status !== 'active')    throw new AppException(ErrorCode.AUTH_ACCOUNT_DISABLED);

  return withTransaction(this.db, async (tx) => {
    await this.tokenRepo.markUsed(row.id, tx);
    const next = await this.tokenRepo.create({
      userId: user.id, familyId: row.familyId, ...ctx,
    }, tx);
    return {
      accessToken: this.signAccessToken(user),
      refreshToken: next.raw,
    };
  });
}
```

**注意 `markUsed` 與 `create` 在同一個交易裡**：否則有可能標記了舊 token 卻沒
建立新的，使用者被無故登出。

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

```ts
private async registerFailedAttempt(user: User, ctx: RequestContext) {
  const count = user.failedLoginCount + 1;
  const shouldLock = count >= env.LOGIN_MAX_ATTEMPTS;   // 5
  await this.userRepo.update(user.id, {
    failedLoginCount: count,
    lockedUntil: shouldLock ? addSeconds(new Date(), env.LOGIN_LOCKOUT_SECONDS) : null,
    status: shouldLock ? 'locked' : user.status,
  });
  await this.audit.loginFailure(user.email, shouldLock ? 'locked' : 'bad_password', ctx);
}
```

解鎖途徑：

1. 等 15 分鐘自動過期（下次成功登入時 `status` 回到 `active`）
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
| 有效期   | 24 小時            | 1 小時                                         |
| 目標狀態 | `pending`          | `active`                                       |
| 完成後   | `status → active`  | `token_version += 1` ＋ 撤銷所有 refresh token |

### 5.1 Token 本身

```ts
const raw = randomBytes(32).toString("base64url"); // 寄出去的
const hash = sha256(raw); // 入庫的
```

**資料庫裡只有雜湊。** 即使資料庫外洩，攻擊者也無法用其中的值重設任何人的密碼。

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
  const user = await this.userRepo.findByEmail(dto.email);
  if (user && user.status === 'active') {
    await this.issueResetToken(user);   // 寄信
  }
  // ★ 不論如何都回 200，且回應時間一致
  return { sent: true };
}
```

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
