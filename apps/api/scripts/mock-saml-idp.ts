/**
 * 開發與 E2E 用的 SAML 2.0 IdP（docs/architecture/04-sso.md §3.3.2）：收 HTTP-Redirect 的 AuthnRequest，
 * 登入頁輸入任何 email 都算登入成功，以 HTTP-POST 把 **簽章過的 assertion** 送回 SP 的 ACS。
 * 也匯出 `createMockSamlIdp()` 給測試直接產生回應（簽章、時間、InResponseTo 都可以改，測驗證的每一道檢查）。
 *
 *   pnpm dev:mock-saml-idp      （:4477）
 *
 * 在 backstage 的「外部 IdP 連線」新增一筆 SAML 連線，貼上 `http://127.0.0.1:4477/metadata` 的內容
 * （或手動填 entity ID、SSO 網址與簽章憑證）。
 *
 * 只給本機用：金鑰與憑證每次啟動重新產生（重啟後要更新連線的憑證）、不檢查密碼。
 */
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { inflateRawSync } from 'node:zlib';

import { generate } from 'selfsigned';
import { SignedXml } from 'xml-crypto';

const PORT = Number(process.env.MOCK_SAML_IDP_PORT ?? 4477);

const NS_PROTOCOL = 'urn:oasis:names:tc:SAML:2.0:protocol';
const NS_ASSERTION = 'urn:oasis:names:tc:SAML:2.0:assertion';
const NAME_ID_PERSISTENT = 'urn:oasis:names:tc:SAML:2.0:nameid-format:persistent';

export interface MockSamlResponseInput {
  /** SP 的 AuthnRequest ID；null 時不帶 `InResponseTo`（IdP 主動發起的回應）。 */
  inResponseTo: string | null;
  acsUrl: string;
  /** SP 的 entity ID（Audience）。 */
  audience: string;
  nameId: string;
  email?: string | null;
  name?: string | null;
  /** 改掉回應的 Issuer（測「不是這個 IdP」）。 */
  issuer?: string;
  /** assertion 的有效期限從現在起算的秒數（負數 = 已過期）。 */
  validForSeconds?: number;
  /** 不簽章（測「assertion 必須簽章」）。 */
  unsigned?: boolean;
  /** 簽完之後竄改 email（測簽章驗證）。 */
  tamperEmail?: string;
}

export interface MockSamlIdp {
  entityId: string;
  ssoUrl: string;
  /** PEM。 */
  certificate: string;
  metadata(): string;
  /** base64 的 `SAMLResponse`（HTTP-POST binding 的表單欄位）。 */
  buildResponse(input: MockSamlResponseInput): string;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

const samlId = () => `_${randomBytes(16).toString('hex')}`;
const certificateBody = (pem: string) =>
  pem.replace(/-----(BEGIN|END) CERTIFICATE-----/g, '').replace(/\s+/g, '');

/** 產生一個 IdP（金鑰與自簽憑證）。`baseUrl` 是它對外的網址（entity ID 與 SSO 網址都從它來）。 */
export async function createMockSamlIdp(baseUrl: string): Promise<MockSamlIdp> {
  const keys = await generate([{ name: 'commonName', value: 'B2B Mock SAML IdP' }], {
    keySize: 2048,
    algorithm: 'sha256',
  });
  const entityId = `${baseUrl}/metadata`;
  const ssoUrl = `${baseUrl}/sso`;

  function sign(xml: string): string {
    const signer = new SignedXml({
      privateKey: keys.private,
      publicCert: keys.cert,
      signatureAlgorithm: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
      canonicalizationAlgorithm: 'http://www.w3.org/2001/10/xml-exc-c14n#',
    });
    signer.addReference({
      xpath: "//*[local-name(.)='Assertion']",
      transforms: [
        'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
        'http://www.w3.org/2001/10/xml-exc-c14n#',
      ],
      digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256',
    });
    // 簽章放在 assertion 的 Issuer 之後（schema 規定的位置）
    signer.computeSignature(xml, {
      location: {
        reference: "//*[local-name(.)='Assertion']/*[local-name(.)='Issuer']",
        action: 'after',
      },
    });
    return signer.getSignedXml();
  }

  return {
    entityId,
    ssoUrl,
    certificate: keys.cert,
    metadata: () =>
      `<?xml version="1.0"?>
<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata" entityID="${escapeXml(entityId)}">
  <md:IDPSSODescriptor WantAuthnRequestsSigned="false" protocolSupportEnumeration="${NS_PROTOCOL}">
    <md:KeyDescriptor use="signing">
      <ds:KeyInfo xmlns:ds="http://www.w3.org/2000/09/xmldsig#">
        <ds:X509Data><ds:X509Certificate>${certificateBody(keys.cert)}</ds:X509Certificate></ds:X509Data>
      </ds:KeyInfo>
    </md:KeyDescriptor>
    <md:NameIDFormat>${NAME_ID_PERSISTENT}</md:NameIDFormat>
    <md:SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="${escapeXml(ssoUrl)}"/>
  </md:IDPSSODescriptor>
</md:EntityDescriptor>
`,
    buildResponse(input) {
      const now = new Date();
      const notBefore = new Date(now.getTime() - 60_000).toISOString();
      const notOnOrAfter = new Date(
        now.getTime() + (input.validForSeconds ?? 300) * 1000,
      ).toISOString();
      const issuer = escapeXml(input.issuer ?? entityId);
      const inResponseTo = input.inResponseTo
        ? ` InResponseTo="${escapeXml(input.inResponseTo)}"`
        : '';
      const attribute = (name: string, value: string | null | undefined) =>
        value
          ? `<saml:Attribute Name="${name}"><saml:AttributeValue>${escapeXml(value)}</saml:AttributeValue></saml:Attribute>`
          : '';
      const assertion = `<saml:Assertion xmlns:saml="${NS_ASSERTION}" ID="${samlId()}" Version="2.0" IssueInstant="${now.toISOString()}"><saml:Issuer>${issuer}</saml:Issuer><saml:Subject><saml:NameID Format="${NAME_ID_PERSISTENT}">${escapeXml(input.nameId)}</saml:NameID><saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer"><saml:SubjectConfirmationData${inResponseTo} NotOnOrAfter="${notOnOrAfter}" Recipient="${escapeXml(input.acsUrl)}"/></saml:SubjectConfirmation></saml:Subject><saml:Conditions NotBefore="${notBefore}" NotOnOrAfter="${notOnOrAfter}"><saml:AudienceRestriction><saml:Audience>${escapeXml(input.audience)}</saml:Audience></saml:AudienceRestriction></saml:Conditions><saml:AuthnStatement AuthnInstant="${now.toISOString()}" SessionIndex="${samlId()}"><saml:AuthnContext><saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport</saml:AuthnContextClassRef></saml:AuthnContext></saml:AuthnStatement><saml:AttributeStatement>${attribute('email', input.email)}${attribute('displayName', input.name)}</saml:AttributeStatement></saml:Assertion>`;
      const response = `<samlp:Response xmlns:samlp="${NS_PROTOCOL}" xmlns:saml="${NS_ASSERTION}" ID="${samlId()}" Version="2.0" IssueInstant="${now.toISOString()}" Destination="${escapeXml(input.acsUrl)}"${inResponseTo}><saml:Issuer>${issuer}</saml:Issuer><samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status>${assertion}</samlp:Response>`;
      let xml = input.unsigned ? response : sign(response);
      if (input.tamperEmail && input.email) {
        xml = xml.replace(escapeXml(input.email), escapeXml(input.tamperEmail));
      }
      return Buffer.from(xml).toString('base64');
    },
  };
}

/** AuthnRequest（HTTP-Redirect：deflate ＋ base64）裡要用到的欄位。 */
function parseAuthnRequest(encoded: string): { id: string; acsUrl: string; issuer: string } {
  const xml = inflateRawSync(Buffer.from(encoded, 'base64')).toString('utf8');
  const id = /\sID="([^"]+)"/.exec(xml)?.[1];
  const acsUrl = /AssertionConsumerServiceURL="([^"]+)"/.exec(xml)?.[1];
  const issuer = /<(?:saml2?:)?Issuer[^>]*>([^<]+)</.exec(xml)?.[1];
  if (!id || !acsUrl || !issuer) throw new Error('AuthnRequest 缺少 ID、ACS 或 Issuer');
  const unescape = (value: string) => value.replace(/&amp;/g, '&');
  return { id, acsUrl: unescape(acsUrl), issuer: unescape(issuer) };
}

function readForm(req: IncomingMessage): Promise<URLSearchParams> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk: Buffer) => (body += chunk.toString('utf8')));
    req.on('end', () => resolve(new URLSearchParams(body)));
    req.on('error', reject);
  });
}

function html(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8' }).end(body);
}

/**
 * 啟動 HTTP 服務：`/metadata`、`/sso`（登入頁）、`/sso/login`（送出回應）。`port = 0` 時用隨機埠（整合測試）。
 * 以 127.0.0.1 對外：與 apps/platform（localhost）是不同的站，ACS 收到的是真正的跨站 POST（SameSite=None 的綁定 cookie）。
 */
export async function startMockSamlIdp(
  port = PORT,
): Promise<{ url: string; server: Server; idp: MockSamlIdp }> {
  let idp: MockSamlIdp | undefined;
  const server = createServer((req, res) => {
    if (!idp) {
      res.writeHead(503).end();
      return;
    }
    handle(idp, req, res);
  });
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
  const { port: actual } = server.address() as { port: number };
  const url = `http://127.0.0.1:${actual}`;
  idp = await createMockSamlIdp(url);
  return { url, server, idp };
}

function handle(idp: MockSamlIdp, req: IncomingMessage, res: ServerResponse): void {
  const requestUrl = new URL(req.url ?? '/', 'http://mock');
  try {
    if (req.method === 'GET' && requestUrl.pathname === '/metadata') {
      res.writeHead(200, { 'content-type': 'application/samlmetadata+xml' }).end(idp.metadata());
      return;
    }
    if (req.method === 'GET' && requestUrl.pathname === '/sso') {
      const request = parseAuthnRequest(requestUrl.searchParams.get('SAMLRequest') ?? '');
      const relayState = requestUrl.searchParams.get('RelayState') ?? '';
      html(
        res,
        200,
        `<!doctype html><title>Mock SAML IdP</title><h1>Mock SAML IdP</h1>
<p>SP：${escapeXml(request.issuer)}</p>
<form method="post" action="/sso/login">
  <input type="hidden" name="requestId" value="${escapeXml(request.id)}">
  <input type="hidden" name="acsUrl" value="${escapeXml(request.acsUrl)}">
  <input type="hidden" name="audience" value="${escapeXml(request.issuer)}">
  <input type="hidden" name="RelayState" value="${escapeXml(relayState)}">
  <label>Email <input name="email" type="email" required autofocus data-testid="mock-saml-email"></label>
  <button type="submit" data-testid="mock-saml-submit">Sign in</button>
</form>`,
      );
      return;
    }
    if (req.method === 'POST' && requestUrl.pathname === '/sso/login') {
      void readForm(req).then((form) => {
        const email = form.get('email') ?? '';
        const acsUrl = form.get('acsUrl') ?? '';
        const samlResponse = idp.buildResponse({
          inResponseTo: form.get('requestId'),
          acsUrl,
          audience: form.get('audience') ?? '',
          // 模擬服務沒有自己的帳號表：NameID 直接用 email（真正的 IdP 用不會變的 persistent id）
          nameId: email,
          email,
          name: email.split('@')[0] ?? email,
        });
        html(
          res,
          200,
          `<!doctype html><title>Redirecting</title>
<form method="post" action="${escapeXml(acsUrl)}">
  <input type="hidden" name="SAMLResponse" value="${samlResponse}">
  <input type="hidden" name="RelayState" value="${escapeXml(form.get('RelayState') ?? '')}">
  <noscript><button type="submit">Continue</button></noscript>
</form>
<script>document.forms[0].submit()</script>`,
        );
      });
      return;
    }
    res.writeHead(404).end();
  } catch (error) {
    html(res, 400, escapeXml(error instanceof Error ? error.message : String(error)));
  }
}

if (require.main === module) {
  void startMockSamlIdp().then(({ url }) =>
    console.log(`模擬的 SAML IdP：${url}（metadata：${url}/metadata）`),
  );
}
