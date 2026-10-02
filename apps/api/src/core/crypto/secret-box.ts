import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;

/** 一把主金鑰的用途：環境變數名稱（錯誤訊息用）與開發用推導金鑰的 HKDF info（不同用途推導出不同金鑰）。 */
export interface SecretKeyPurpose {
  envName: string;
  info: string;
}

/** 外部 IdP 的 client secret（docs/adr/0019-sso-identity-platform.md D11）。 */
export const IDP_SECRET_PURPOSE: SecretKeyPurpose = {
  envName: 'IDP_SECRET_KEY',
  info: 'idp-secret-key',
};

/** 租戶資料庫的連線字串（docs/adr/0020-physical-tenant-isolation.md D4）。 */
export const TENANT_SECRET_PURPOSE: SecretKeyPurpose = {
  envName: 'TENANT_SECRET_KEY',
  info: 'tenant-secret-key',
};

/** webhook 的簽章密鑰（docs/adr/0030-webhooks.md D14）。 */
export const WEBHOOK_SECRET_PURPOSE: SecretKeyPurpose = {
  envName: 'WEBHOOK_SECRET_KEY',
  info: 'webhook-secret-key',
};

/**
 * 以 AES-256-GCM 加密後存資料庫的機密：資料庫外洩時沒有主金鑰就解不開。
 * 密文格式 `iv.tag.ciphertext`（各自 base64url）。
 */
export class SecretBox {
  private constructor(private readonly key: Buffer) {}

  /** 主金鑰（32 bytes，base64）；沒有時由 `fallbackSeed` 以 HKDF 推導（僅開發用，重啟後仍解得開）。 */
  static fromConfig(
    secretKey: string | undefined,
    fallbackSeed: string,
    purpose: SecretKeyPurpose,
  ): SecretBox {
    if (secretKey) {
      const key = Buffer.from(secretKey, 'base64');
      if (key.length !== 32) throw new Error(`${purpose.envName} 必須是 32 bytes（base64）`);
      return new SecretBox(key);
    }
    return new SecretBox(
      Buffer.from(hkdfSync('sha256', fallbackSeed, 'b2b-system', purpose.info, 32)),
    );
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString('base64url')).join('.');
  }

  decrypt(sealed: string): string {
    const [iv, tag, encrypted] = sealed.split('.').map((part) => Buffer.from(part, 'base64url'));
    if (!iv || !tag || !encrypted) throw new Error('密文格式不正確');
    const decipher = createDecipheriv(ALGORITHM, this.key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
  }
}
