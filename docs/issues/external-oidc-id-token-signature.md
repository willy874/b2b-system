# 外部 IdP 的 ID token：註解說會驗簽章，實際沒有驗

## 現況

`apps/api/src/modules/identity-provider/external-oidc.client.ts` 第 37 行，`ExternalOidcClient.exchange` 的註解寫
「驗證 ID token（state、nonce、PKCE、**簽章**、audience）」。

實作用 `openid-client` 6.8.8 的 Authorization Code ＋ PKCE 兌換。這個版本對 **token 端點回來的** ID token
預設不驗 JWS 簽章（以 TLS 直接取得為依據），要呼叫 `enableNonRepudiationChecks(config)`（或在 `discovery` 的
`execute` 帶上它）才會驗；程式裡沒有呼叫（`grep enableNonRepudiationChecks apps/api/src` 無結果）。

重現：`external-oidc.client.spec.ts` 以 `vi.stubGlobal('fetch')` 模擬 IdP 時，簽章是亂碼的 id_token 也會被接受，
JWKS 端點從頭到尾不會被請求。

其餘檢查（state、nonce、PKCE、`iss`、`aud`、`exp`、userinfo 的 `sub` 一致）都有做，單元測試逐項斷言。

## 影響

- OIDC Core §3.1.3.7 第 6 點允許：ID token 直接從 token 端點以 TLS 取得時，可用 TLS 的伺服器驗證取代簽章驗證。
  production 只接受 https 的 issuer、對外連線以 `pinnedFetch` 送出（[`04-sso.md`](../architecture/04-sso.md) §3.3），
  所以目前的做法 **符合規範**，沒有已知的可利用路徑。
- 但註解（以及讀者對 [`04-sso.md`](../architecture/04-sso.md) §12.2 D8「驗 ID token」的理解）與實作不一致：
  之後若有人依註解假設簽章已驗（例如改走 front-channel 或 `form_post` 的 response mode），就會出現真的漏洞。

嚴重度：中（規格與實作不一致；目前不造成錯誤結果）。

## 修正方式

擇一，需要決定：

1. **真的驗簽**：建立 `Configuration` 後呼叫 `client.enableNonRepudiationChecks(config)`。
   代價是每次兌換多一次 JWKS 請求（openid-client 會快取），JWKS 也要走 `pinnedFetch`。
2. **維持現狀**：把註解改成「簽章不驗：ID token 由 token 端點以 TLS 直接取得（OIDC Core §3.1.3.7 第 6 點）」，
   並在 `04-sso.md` §12.2 D8 寫明這個決定與前提（只用 code flow、issuer 只接受 https）。

## 驗證方式

- 選 1：`external-oidc.client.spec.ts` 加一個案例：簽章被竄改的 id_token → `exchange` 拒絕，且 JWKS 端點被請求一次。
- 選 2：同檔加一個案例鎖住目前行為（簽章不正確仍接受），測試名稱寫明依據，避免日後誤以為有驗。

（2026-10-08 補單元測試時由 `external-oidc.client.spec.ts` 的撰寫發現。）
