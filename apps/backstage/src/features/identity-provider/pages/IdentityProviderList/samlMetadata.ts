/**
 * 從 IdP 的 SAML metadata（XML）取出建立連線要的欄位（docs/architecture/04-sso.md §3.3.2）：
 * 管理員貼上 metadata，表單自動填入 entity ID、SSO 網址（HTTP-Redirect binding）與簽章憑證。
 * 只在瀏覽器解析、不送到伺服器；伺服器只收拆好的欄位，並自己檢查憑證。
 */

const MD_NS = 'urn:oasis:names:tc:SAML:2.0:metadata';
const DS_NS = 'http://www.w3.org/2000/09/xmldsig#';
const REDIRECT_BINDING = 'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect';

export interface ParsedIdpMetadata {
  entityId: string;
  ssoUrl: string;
  certificates: string[];
}

export type MetadataParseError = 'invalidXml' | 'noIdpDescriptor' | 'noRedirectBinding';

function toPem(base64: string): string {
  const body = base64.replace(/\s+/g, '');
  return `-----BEGIN CERTIFICATE-----\n${body.match(/.{1,64}/g)?.join('\n') ?? body}\n-----END CERTIFICATE-----`;
}

export function parseIdpMetadata(
  xml: string,
): { ok: true; value: ParsedIdpMetadata } | { ok: false; error: MetadataParseError } {
  const doc = new DOMParser().parseFromString(xml.trim(), 'application/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) return { ok: false, error: 'invalidXml' };
  // 可能是單一的 EntityDescriptor，也可能包在 EntitiesDescriptor 裡：取第一個有 IdP 角色的
  const descriptor = [...doc.getElementsByTagNameNS(MD_NS, 'IDPSSODescriptor')][0];
  const entity = descriptor?.parentElement;
  const entityId = entity?.getAttribute('entityID');
  if (!descriptor || !entityId) return { ok: false, error: 'noIdpDescriptor' };

  const sso = [...descriptor.getElementsByTagNameNS(MD_NS, 'SingleSignOnService')].find(
    (element) => element.getAttribute('Binding') === REDIRECT_BINDING,
  );
  const ssoUrl = sso?.getAttribute('Location');
  if (!ssoUrl) return { ok: false, error: 'noRedirectBinding' };

  // 簽章用的金鑰：use="signing" 或沒有標 use 的（只用來加密的不算）
  const certificates: string[] = [];
  for (const key of descriptor.getElementsByTagNameNS(MD_NS, 'KeyDescriptor')) {
    if ((key.getAttribute('use') ?? 'signing') !== 'signing') continue;
    for (const element of key.getElementsByTagNameNS(DS_NS, 'X509Certificate')) {
      const body = element.textContent?.trim();
      if (body) certificates.push(body);
    }
  }
  const unique = [...new Set(certificates)].slice(0, 3).map(toPem);
  return { ok: true, value: { entityId, ssoUrl, certificates: unique } };
}
