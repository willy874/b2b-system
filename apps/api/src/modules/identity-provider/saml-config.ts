import { X509Certificate } from 'node:crypto';

import { z } from 'zod';

import { SamlNameIdFormatSchema } from './dto/identity-provider.dto';

/**
 * SAML 連線存在 `identity_providers.config` 的形狀（docs/architecture/04-sso.md §3.3.2）。
 * IdP 的 entity ID 存在 `issuer` 欄（與 OIDC 的 issuer 同一個意義：subject 的命名空間）。
 */
export const SamlStoredConfigSchema = z.object({
  ssoUrl: z.string(),
  certificates: z.array(z.string()).min(1),
  nameIdFormat: SamlNameIdFormatSchema,
  emailAttribute: z.string().nullable(),
  nameAttribute: z.string().nullable(),
});

export type SamlStoredConfig = z.infer<typeof SamlStoredConfigSchema>;

export interface CertificateSummary {
  pem: string;
  subject: string;
  notAfter: string;
  fingerprint: string;
}

/**
 * 正規化成標準的 PEM（管理員常貼上沒有標頭、或 metadata 裡的 base64）；解析不了時回傳 null。
 * 只接受 X.509 憑證，不接受私鑰或公鑰。
 */
export function normalizeCertificate(input: string): string | null {
  const body = input
    .replace(/-----BEGIN CERTIFICATE-----/g, '')
    .replace(/-----END CERTIFICATE-----/g, '')
    .replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/]+=*$/.test(body)) return null;
  const pem = `-----BEGIN CERTIFICATE-----\n${body.match(/.{1,64}/g)?.join('\n') ?? body}\n-----END CERTIFICATE-----\n`;
  try {
    new X509Certificate(pem);
    return pem;
  } catch {
    // 不是 X.509 憑證：呼叫端回 IDENTITY_PROVIDER_CERTIFICATE_INVALID
    return null;
  }
}

/** 管理頁顯示用：主體、到期時間、SHA-256 指紋。 */
export function describeCertificate(pem: string): CertificateSummary {
  const certificate = new X509Certificate(pem);
  return {
    pem,
    subject: certificate.subject.replace(/\n/g, ', '),
    notAfter: new Date(certificate.validTo).toISOString(),
    fingerprint: certificate.fingerprint256,
  };
}
