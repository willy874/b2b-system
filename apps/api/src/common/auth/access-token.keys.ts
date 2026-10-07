import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

import type { Env } from '@/core/config';
import { deriveSigningKeyRing, parseSigningKeys } from '@/core/crypto';
import type { SigningKeyRing } from '@/core/crypto';

/** 租戶的 token 與平台管理者的 token 各一組金鑰環（docs/architecture/backend/04-auth.md §11 D4）。 */
export type AccessTokenRealm = 'tenant' | 'platform';

/** 只接受 HS256：不信任 token 自稱的 `alg`（`none`、以 HMAC 金鑰冒充 RS256 的混淆）。 */
const ALGORITHMS = ['HS256'] as const;

function ringOf(
  value: string | undefined,
  seed: string | undefined,
  purpose: string,
): SigningKeyRing | undefined {
  if (value) {
    const parsed = parseSigningKeys(value);
    // 環境變數驗證已經擋過格式；這裡只為了型別
    if (typeof parsed === 'string') throw new Error(`金鑰環格式不對：${parsed}`);
    return parsed;
  }
  return seed ? deriveSigningKeyRing(seed, purpose) : undefined;
}

/**
 * access token 的簽發與驗簽（docs/architecture/backend/04-auth.md §11）。
 *
 * - 簽發：依 realm 用那一組金鑰環的第一把，header 帶 `kid`。
 * - 驗簽：依 header 的 `kid` 在 **這個網域該用的那一組** 裡找金鑰（租戶網域只看租戶的、沒有租戶的網域只看平台的），
 *   找不到就拒絕；演算法固定 HS256。
 * - 過渡期：沒有 `kid` 的舊 token 以 `JWT_SECRET` 驗證（有設定時才接受）；從環境拿掉 `JWT_SECRET` 就一律拒絕。
 * - 對外 API 的程序沒有任何金鑰：一律拒絕（它只認 API token，docs/architecture/06-external-api.md §6）。
 */
@Injectable()
export class AccessTokenKeys {
  private readonly rings: Partial<Record<AccessTokenRealm, SigningKeyRing>>;
  private readonly legacy: string | undefined;

  constructor(
    private readonly jwt: JwtService,
    config: ConfigService<Env, true>,
  ) {
    const internal = config.get('API_SURFACE', { infer: true }) === 'internal';
    const production = config.get('NODE_ENV', { infer: true }) === 'production';
    const secret = config.get('JWT_SECRET', { infer: true });
    // production 不推導：金鑰環必填（env.schema.ts），推導只給開發與測試
    const seed = production ? undefined : secret;
    this.rings = internal
      ? {
          tenant: ringOf(
            config.get('JWT_SIGNING_KEYS', { infer: true }),
            seed,
            'access-token/tenant',
          ),
          platform: ringOf(
            config.get('PLATFORM_JWT_SIGNING_KEYS', { infer: true }),
            seed,
            'access-token/platform',
          ),
        }
      : {};
    this.legacy = internal ? secret : undefined;
  }

  async sign(realm: AccessTokenRealm, payload: object, expiresIn: number): Promise<string> {
    const ring = this.rings[realm];
    if (!ring) throw new Error(`這個程序沒有 ${realm} 的 access token 金鑰`);
    return this.jwt.signAsync(payload, {
      secret: ring.signing.key,
      keyid: ring.signing.kid,
      algorithm: 'HS256',
      expiresIn,
    });
  }

  /** 驗簽並回傳 payload；任何失敗（未知的 `kid`、簽章、過期、演算法）都回 `undefined`。 */
  async verify<T extends object>(realm: AccessTokenRealm, token: string): Promise<T | undefined> {
    const header = this.headerOf(token);
    if (!header) return undefined;
    const key = header.kid === undefined ? this.legacy : this.rings[realm]?.byKid.get(header.kid);
    if (!key) return undefined;
    try {
      return await this.jwt.verifyAsync<T>(token, { secret: key, algorithms: [...ALGORITHMS] });
    } catch {
      return undefined;
    }
  }

  private headerOf(token: string): { kid?: string } | undefined {
    const decoded: unknown = this.jwt.decode(token, { complete: true });
    if (typeof decoded !== 'object' || decoded === null) return undefined;
    const header = (decoded as { header?: unknown }).header;
    if (typeof header !== 'object' || header === null) return undefined;
    const kid = (header as { kid?: unknown }).kid;
    if (kid !== undefined && typeof kid !== 'string') return undefined;
    return kid === undefined ? {} : { kid };
  }
}
