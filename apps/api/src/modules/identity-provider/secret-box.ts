import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;

/**
 * 外部 IdP 的 client secret 以 AES-256-GCM 加密後存資料庫（docs/adr/0019-sso-identity-platform.md D11）：
 * 資料庫外洩時沒有主金鑰就解不開。密文格式 `iv.tag.ciphertext`（各自 base64url）。
 */
export class SecretBox {
  private constructor(private readonly key: Buffer) {}

  /** `IDP_SECRET_KEY`（32 bytes）；沒有時由 `fallbackSeed` 以 HKDF 推導（僅開發用，重啟後仍解得開）。 */
  static fromConfig(secretKey: string | undefined, fallbackSeed: string): SecretBox {
    if (secretKey) {
      const key = Buffer.from(secretKey, 'base64');
      if (key.length !== 32) throw new Error('IDP_SECRET_KEY 必須是 32 bytes（base64）');
      return new SecretBox(key);
    }
    return new SecretBox(
      Buffer.from(hkdfSync('sha256', fallbackSeed, 'b2b-system', 'idp-secret-key', 32)),
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
