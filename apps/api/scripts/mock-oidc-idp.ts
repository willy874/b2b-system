/**
 * 開發與 E2E 用的「外部 IdP」（docs/architecture/04-sso.md §12.2 D8）：一個最小的 OIDC provider，
 * 登入頁（oidc-provider 的 devInteractions）輸入任何 email 都算登入成功，`sub` 與 `email` 就是那個 email。
 *
 *   pnpm dev:mock-idp
 *
 * 在 apps/auth 的「外部 IdP 連線」新增一筆：
 *   issuer        http://localhost:4455
 *   client id     b2b-mock
 *   client secret mock-secret
 *
 * 只給本機用：沒有持久化、金鑰每次啟動重新產生、不檢查密碼。
 */
import Provider from 'oidc-provider';

const PORT = Number(process.env.MOCK_IDP_PORT ?? 4455);
const ISSUER = `http://localhost:${PORT}`;
/** api 的固定 callback（`IdentityProviderService.callbackUrl()`；瀏覽器看到的是 apps/auth 的 origin）。 */
const CALLBACK_URL =
  process.env.MOCK_IDP_CALLBACK_URL ??
  'http://localhost:5175/api/oidc-interaction/external/callback';

const provider = new Provider(ISSUER, {
  clients: [
    {
      client_id: process.env.MOCK_IDP_CLIENT_ID ?? 'b2b-mock',
      client_secret: process.env.MOCK_IDP_CLIENT_SECRET ?? 'mock-secret',
      redirect_uris: [CALLBACK_URL],
      response_types: ['code'],
      grant_types: ['authorization_code'],
    },
  ],
  claims: { email: ['email', 'email_verified'], profile: ['name'] },
  features: { devInteractions: { enabled: true } },
  findAccount: (_ctx, id) => ({
    accountId: id,
    claims: () => ({
      sub: id,
      email: id,
      email_verified: true,
      name: id.includes('@') ? id.slice(0, id.indexOf('@')) : id,
    }),
  }),
});

provider.listen(PORT, () => {
  console.log(`模擬外部 IdP：${ISSUER}（callback：${CALLBACK_URL}）`);
});
