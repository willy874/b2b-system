# `safeReturnTo()` 遇到 `.`／`..` 路徑段時會回傳 protocol-relative 的 `//外站`

## 現況

`packages/web-core/src/auth/sso.ts` 的 `safeReturnTo()`（L51–57）：

```ts
const url = new URL(value, origin);
return url.origin === origin ? `${url.pathname}${url.search}${url.hash}` : '/';
```

它比對的是解析後的 origin，回傳的卻是正規化之後的 `pathname`。輸入含 `.`／`..` 路徑段時，origin 是本站，`pathname` 卻以 `//` 開頭：

| 輸入 | 回傳 |
| --- | --- |
| `/.//evil.example.com` | `//evil.example.com` |
| `/a/..//evil.example.com` | `//evil.example.com` |
| `/%2e//evil.example.com` | `//evil.example.com` |
| `/./\evil.example.com` | `//evil.example.com` |

以上用 Node 的 WHATWG `URL` 實測，瀏覽器的解析規則相同。`//evil.example.com` 是 protocol-relative URL，當成網址使用會連到 `https://evil.example.com/`。

- 回傳值存進 sessionStorage 的 pending login：`createAuthorizationUrl()`（L74）與 `readPendingLogin()`（L100）都經過它。
- 目前唯一的使用處是兩個 app 的 SSO callback，以 `router.history.replace(pending.returnTo)` 換頁：
  - `apps/backstage/src/features/auth/pages/SsoCallback/page.tsx`（L45）
  - `apps/platform/src/features/login/pages/SsoCallback/page.tsx`（L45）
- `@tanstack/history`（目前 1.162.4）的 `parseHref()` 會用 `normalizeProtocolRelative()`，把 `//evil.example.com` 改成 `/evil.example.com`，所以 **現在不會跳站**。
- `packages/web-core/src/auth/__tests__/sso.test.ts`（L52–65）測了 `//`、`/\`、`/\/`，沒有含路徑段的案例。

若使用處改成直接導覽，攻擊步驟如下：

1. 攻擊者寄出 `https://<租戶網域>/auth/login?redirect=/.//evil.example.com`。
2. 使用者登入後，`returnTo` 是 `//evil.example.com`。
3. callback 若用 `location.assign(returnTo)`、`<a href={returnTo}>`，或換成不做這個正規化的 router，使用者剛登入就被導到外站的釣魚頁。

## 影響

- 目前沒有實際的 open redirect：安全性靠的是 `@tanstack/history` 的內部正規化，不是 `safeReturnTo()` 本身。
- `safeReturnTo()` 從 `@b2b-system/web-core/auth` 對外提供，文件寫明「只接受同源相對路徑」（[`04-sso.md`](../architecture/04-sso.md) §6.1），§8 也要求新產品照抄這一套。
  之後任何把回傳值交給 `location`、`href` 的地方，都會變成 open redirect。

## 修正方式

`safeReturnTo()` 解析之後，路徑以 `//` 開頭就退回 `/`：

```ts
const url = new URL(value, origin);
if (url.origin !== origin || url.pathname.startsWith('//')) return '/';
return `${url.pathname}${url.search}${url.hash}`;
```

`pathname` 已經過 WHATWG 解析，反斜線會被換成 `/`，所以只要檢查 `//`。

## 驗證方式

`packages/web-core/src/auth/__tests__/sso.test.ts` 的 `it.each`（L52–62）補上：

- `['/.//evil.example.com', '/']`
- `['/a/..//evil.example.com', '/']`
- `['/%2e//evil.example.com', '/']`
- `['/./\\evil.example.com', '/']`
- `['/a/../users', '/users']`：一般的路徑正規化不受影響。
