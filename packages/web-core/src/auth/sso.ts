/**
 * SSO 的瀏覽器端（docs/architecture/04-sso.md §12）：OIDC Authorization Code ＋ PKCE。
 *
 * - **開始**：產生 PKCE verifier 與 `state`，存在 **這個分頁** 的 sessionStorage，然後 **頂層跳轉** 到 IdP。
 * - **callback**：IdP 帶 `code` 與 `state` 跳回來；以 `state` 取回 verifier，交給自己 origin 的 BFF 換 app session。
 *
 * 服務之間只以頂層跳轉溝通，不用跨域 cookie、iframe 或 `postMessage`（D6）。verifier 不是 token：
 * 沒有授權碼就沒有用，而授權碼只會送到登記過的 redirect URI。
 */

export interface SsoClientConfig {
  /** OIDC issuer（瀏覽器看到的網址，例：`https://auth.example.com/api/oidc`）。 */
  issuer: string;
  clientId: string;
  /** 這個 app 的 callback 路徑（與 api 登記的 redirect URI 一致）。 */
  callbackPath: string;
}

interface PendingLogin {
  verifier: string;
  /** 登入後回到的頁面（同 origin 的路徑）。 */
  returnTo: string;
}

const STORAGE_PREFIX = 'sso:pending:';

function randomBase64Url(bytes: number): string {
  const buffer = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(buffer);
  return toBase64Url(buffer);
}

function toBase64Url(buffer: Uint8Array): string {
  let binary = '';
  for (const byte of buffer) binary += String.fromCodePoint(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

async function challengeOf(verifier: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(verifier),
  );
  return toBase64Url(new Uint8Array(digest));
}

/**
 * 只接受同 origin 的路徑，避免登入後被導到別的網站（open redirect）。以瀏覽器實際的解析結果判斷：
 * `/\evil.com` 字面上是 `/` 開頭，瀏覽器卻把 `\` 當成 `/`、解析成 `//evil.com`。
 *
 * 回傳的是正規化後的路徑，所以也要檢查它本身：`/.//evil.com`、`/a/..//evil.com` 解析後 origin 是本站，
 * `pathname` 卻是 `//evil.com`——交給 `location`、`href` 就是 protocol-relative 的外站網址。
 * `pathname` 已把 `\` 換成 `/`，只要檢查 `//`。
 */
export function safeReturnTo(value: string | undefined): string {
  if (!value?.startsWith('/')) return '/';
  const { origin } = globalThis.location;
  if (!URL.canParse(value, origin)) return '/';
  const url = new URL(value, origin);
  if (url.origin !== origin || url.pathname.startsWith('//')) return '/';
  return `${url.pathname}${url.search}${url.hash}`;
}

export function redirectUriOf(config: SsoClientConfig): string {
  return `${globalThis.location.origin}${config.callbackPath}`;
}

/**
 * 組 IdP 的授權網址，並記下這次登入的 verifier（以 `state` 為鍵）。
 * `extraParams`：authorize 的額外參數，例如 backstage 的 `tenant`（docs/architecture/05-tenancy.md §10.2 D7）。
 */
export async function createAuthorizationUrl(
  config: SsoClientConfig,
  returnTo: string | undefined,
  extraParams: Record<string, string> = {},
): Promise<string> {
  const verifier = randomBase64Url(32);
  const state = randomBase64Url(16);
  const pending: PendingLogin = { verifier, returnTo: safeReturnTo(returnTo) };
  globalThis.sessionStorage.setItem(STORAGE_PREFIX + state, JSON.stringify(pending));
  const query = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: redirectUriOf(config),
    response_type: 'code',
    scope: 'openid email profile',
    state,
    code_challenge: await challengeOf(verifier),
    code_challenge_method: 'S256',
    ...extraParams,
  });
  return `${config.issuer}/auth?${query.toString()}`;
}

/**
 * IdP 的 end-session 網址（OIDC RP-Initiated Logout）：使用者在 IdP 的確認頁按下登出後，IdP session 與它底下所有產品的
 * app session 一起結束，再回到 `loggedOutPath`（api 登記的 post-logout redirect URI）。
 *
 * 只當作伺服器端登出一直失敗時的手動退路（docs/architecture/04-sso.md §3.4）——一般的登出不跳轉，
 * 停在「已登出」頁（§12.2 D5）。
 */
export function endSessionUrlOf(config: SsoClientConfig, loggedOutPath: string): string {
  const query = new URLSearchParams({
    client_id: config.clientId,
    post_logout_redirect_uri: `${globalThis.location.origin}${loggedOutPath}`,
  });
  return `${config.issuer}/session/end?${query.toString()}`;
}

/**
 * 讀取這次登入的 verifier（不刪除：render 時就要知道 callback 是否有效）；找不到代表不是這個分頁發起的（或已經用過）。
 * 開始兌換時呼叫 `discardPendingLogin()`，同一個 verifier 不會用兩次。
 */
export function readPendingLogin(state: string | undefined): PendingLogin | undefined {
  if (!state) return undefined;
  const raw = globalThis.sessionStorage.getItem(STORAGE_PREFIX + state);
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as Partial<PendingLogin>;
    return typeof parsed.verifier === 'string'
      ? { verifier: parsed.verifier, returnTo: safeReturnTo(parsed.returnTo) }
      : undefined;
  } catch {
    // 格式不對等同沒有：不能用來兌換
    return undefined;
  }
}

export function discardPendingLogin(state: string | undefined): void {
  if (state) globalThis.sessionStorage.removeItem(STORAGE_PREFIX + state);
}
