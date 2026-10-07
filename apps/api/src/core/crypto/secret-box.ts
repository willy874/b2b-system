import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;

/** 一把主金鑰的用途：環境變數名稱（錯誤訊息用）與開發用推導金鑰的 HKDF info（不同用途推導出不同金鑰）。 */
export interface SecretKeyPurpose {
  envName: string;
  info: string;
}

/** 外部 IdP 的 client secret（docs/architecture/04-sso.md §12.2 D11）。 */
export const IDP_SECRET_PURPOSE: SecretKeyPurpose = {
  envName: 'IDP_SECRET_KEY',
  info: 'idp-secret-key',
};

/** 租戶資料庫的連線字串（docs/architecture/05-tenancy.md §10.2 D4）。 */
export const TENANT_SECRET_PURPOSE: SecretKeyPurpose = {
  envName: 'TENANT_SECRET_KEY',
  info: 'tenant-secret-key',
};

/** webhook 的簽章密鑰（docs/architecture/backend/17-webhook.md §9.2 D14）。 */
export const WEBHOOK_SECRET_PURPOSE: SecretKeyPurpose = {
  envName: 'WEBHOOK_SECRET_KEY',
  info: 'webhook-secret-key',
};

/** MFA 的 TOTP seed 與 Email 驗證碼的 HMAC 金鑰（docs/architecture/backend/21-mfa.md §3、D13）。 */
export const MFA_SECRET_PURPOSE: SecretKeyPurpose = {
  envName: 'MFA_SECRET_KEY',
  info: 'mfa-secret-key',
};

/**
 * 以 AES-256-GCM 加密後存資料庫的機密：資料庫外洩時沒有主金鑰就解不開。
 * 密文格式 `iv.tag.ciphertext`（各自 base64url）。
 */
export class SecretBox {
  private constructor(
    private readonly key: Buffer | null,
    private readonly purpose: SecretKeyPurpose,
  ) {}

  /**
   * 主金鑰（32 bytes，base64）；沒有時由 `fallbackSeed` 以 HKDF 推導（僅開發用，重啟後仍解得開）。
   * `fallbackSeed` 是 `null` 時不推導（production）：沒有金鑰的程序要加解密時才拋錯，不會以推導出的另一把金鑰
   * 寫出別的程序解不開的密文。對外 API 的程序載入了這些模組，卻不持有金鑰（docs/architecture/06-external-api.md §6）。
   */
  static fromConfig(
    secretKey: string | undefined,
    fallbackSeed: string | null,
    purpose: SecretKeyPurpose,
  ): SecretBox {
    if (secretKey) {
      const key = Buffer.from(secretKey, 'base64');
      if (key.length !== 32) throw new Error(`${purpose.envName} 必須是 32 bytes（base64）`);
      return new SecretBox(key, purpose);
    }
    if (fallbackSeed === null) return new SecretBox(null, purpose);
    return new SecretBox(
      Buffer.from(hkdfSync('sha256', fallbackSeed, 'b2b-system', purpose.info, 32)),
      purpose,
    );
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.requireKey(), iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString('base64url')).join('.');
  }

  decrypt(sealed: string): string {
    const [iv, tag, encrypted] = sealed.split('.').map((part) => Buffer.from(part, 'base64url'));
    if (!iv || !tag || !encrypted) throw new Error('密文格式不正確');
    const decipher = createDecipheriv(ALGORITHM, this.requireKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
  }

  /**
   * 由主金鑰以 HKDF 推導另一種用途的子金鑰（例：MFA 驗證碼的 HMAC）：同一把主金鑰不直接用在兩種演算法上。
   */
  deriveKey(info: string): Buffer {
    return Buffer.from(hkdfSync('sha256', this.requireKey(), 'b2b-system', info, 32));
  }

  private requireKey(): Buffer {
    if (!this.key) throw new Error(`這個程序沒有設定 ${this.purpose.envName}，不能加解密`);
    return this.key;
  }
}
