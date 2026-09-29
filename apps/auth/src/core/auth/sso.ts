/**
 * SSO 的瀏覽器端（docs/adr/0019-sso-identity-platform.md）：OIDC Authorization Code ＋ PKCE。
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

/** 只接受同 origin 的路徑，避免登入後被導到別的網站（open redirect）。 */
export function safeReturnTo(value: string | undefined): string {
  return value?.startsWith('/') && !value.startsWith('//') ? value : '/';
}

export function redirectUriOf(config: SsoClientConfig): string {
  return `${globalThis.location.origin}${config.callbackPath}`;
}

/** 組 IdP 的授權網址，並記下這次登入的 verifier（以 `state` 為鍵）。 */
export async function createAuthorizationUrl(
  config: SsoClientConfig,
  returnTo: string | undefined,
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
  });
  return `${config.issuer}/auth?${query.toString()}`;
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
