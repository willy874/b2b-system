import { createHmac } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '@/core/config';
import { MFA_SECRET_PURPOSE, SecretBox } from '@/core/crypto';

import type { MfaSecrets } from './mfa-method';

/** HMAC 子金鑰的 HKDF info：與加密 seed 的主金鑰不同用途。 */
const HMAC_KEY_INFO = 'mfa-code-hmac';

/**
 * `MFA_SECRET_KEY` 的加解密與 HMAC（docs/architecture/backend/21-mfa.md §3、D13）。
 * production 不推導金鑰：對外 API 的程序不持有它（docs/architecture/06-external-api.md §6），要用時才拋錯。
 */
@Injectable()
export class MfaSecretService implements MfaSecrets {
  private readonly box: SecretBox;
  private hmacKey?: Buffer;

  constructor(config: ConfigService<Env, true>) {
    const production = config.get('NODE_ENV', { infer: true }) === 'production';
    this.box = SecretBox.fromConfig(
      config.get('MFA_SECRET_KEY', { infer: true }),
      production ? null : (config.get('JWT_SECRET', { infer: true }) ?? null),
      MFA_SECRET_PURPOSE,
    );
  }

  encrypt(plaintext: string): string {
    return this.box.encrypt(plaintext);
  }

  decrypt(sealed: string): string {
    return this.box.decrypt(sealed);
  }

  hmac(data: string): string {
    this.hmacKey ??= this.box.deriveKey(HMAC_KEY_INFO);
    return createHmac('sha256', this.hmacKey).update(data).digest('hex');
  }
}
