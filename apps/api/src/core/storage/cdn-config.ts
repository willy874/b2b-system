import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '../config';
import { parseSigningKeys } from '../crypto/signing-keys';
import type { SigningKeyRing } from '../crypto/signing-keys';
import { parseCdnResources } from './cdn-resource';
import type { CdnResource } from './cdn-resource';

/** 部署層的 CDN 設定（環境變數，啟動時驗證過；docs/architecture/backend/09-file.md §16.5）。 */
export interface CdnDeployment {
  provider: Env['FILE_CDN_PROVIDER'];
  /** 例：`https://cdn.example.com`（沒有結尾的 `/`）。 */
  origin: string;
  signingKeys: SigningKeyRing;
  /** 內部的清理端點；`undefined`：這個程序不清理（對外 API、或關掉了自動清理）。 */
  purgeUrl: string | undefined;
  purgeSecret: Buffer | undefined;
  purgeTimeoutMs: number;
}

/**
 * CDN 的 **生效值** 只從這裡讀（docs/architecture/backend/09-file.md §16.5）：簽章（`CdnUrlSigner`）與清理（`CdnPurger`）
 * 每次都問它，不各自讀環境變數。這一版的值全部來自環境變數；之後的執行期設定（平台 DB 的覆寫，docs/features/cdn-settings.md）
 * 只改這個類別的實作——`servesResource` 等方法在那時才會隨時間改變，所以呼叫端每次都要重新問，不要快取結果。
 */
@Injectable()
export class CdnConfig {
  private readonly resources: ReadonlySet<CdnResource>;
  private readonly deploymentValue: CdnDeployment | undefined;
  private readonly maxTtl: number;
  private readonly purgeOnDeleteValue: boolean;
  private readonly purgeBatch: number;

  constructor(config: ConfigService<Env, true>) {
    this.maxTtl = config.get('FILE_CDN_MAX_URL_TTL', { infer: true });
    this.purgeBatch = config.get('FILE_CDN_PURGE_BATCH_SIZE', { infer: true });
    if (!config.get('FILE_CDN_ENABLED', { infer: true })) {
      this.resources = new Set();
      this.purgeOnDeleteValue = false;
      return;
    }
    // FILE_CDN_ENABLED=true 時 env.schema.ts 已檢查過格式：這裡解析失敗代表繞過了驗證
    const keys = parseSigningKeys(config.get('FILE_CDN_SIGNING_KEYS', { infer: true }) ?? '');
    const resources = parseCdnResources(config.get('FILE_CDN_RESOURCES', { infer: true }));
    const origin = config.get('FILE_CDN_ORIGIN', { infer: true });
    if (typeof keys === 'string' || typeof resources === 'string' || !origin) {
      throw new Error('FILE_CDN_* 的設定不正確：請檢查環境變數驗證（env.schema.ts）');
    }
    const purgeOnDelete = config.get('FILE_CDN_PURGE_ON_DELETE', { infer: true });
    const purgeSecret = config.get('FILE_CDN_PURGE_SECRET', { infer: true });
    this.resources = resources;
    this.purgeOnDeleteValue = purgeOnDelete;
    this.deploymentValue = {
      provider: config.get('FILE_CDN_PROVIDER', { infer: true }),
      origin: origin.replace(/\/+$/, ''),
      signingKeys: keys,
      purgeUrl: config.get('FILE_CDN_PURGE_URL', { infer: true })?.replace(/\/+$/, ''),
      purgeSecret: purgeSecret ? Buffer.from(purgeSecret, 'base64') : undefined,
      purgeTimeoutMs: config.get('FILE_CDN_PURGE_TIMEOUT_MS', { infer: true }),
    };
  }

  /** 這個部署有沒有 CDN（`FILE_CDN_ENABLED`）。沒有時下面的方法一律回「不走 CDN」。 */
  get isDeployed(): boolean {
    return this.deploymentValue !== undefined;
  }

  /** 部署層的設定；沒有 CDN 時是 `undefined`。 */
  get deployment(): CdnDeployment | undefined {
    return this.deploymentValue;
  }

  /** 這種資源現在要不要簽成 CDN 網址。 */
  servesResource(resource: CdnResource | undefined): boolean {
    return resource !== undefined && this.isDeployed && this.resources.has(resource);
  }

  /** CDN 網址效期的上限（秒）。 */
  maxUrlTtl(): number {
    return this.maxTtl;
  }

  /** 物件永久刪除後要不要排入清理。 */
  purgeOnDelete(): boolean {
    return this.isDeployed && this.purgeOnDeleteValue;
  }

  /** 一筆 `cdn.purge` 最多幾個路徑。 */
  purgeBatchSize(): number {
    return this.purgeBatch;
  }
}
