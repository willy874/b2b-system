import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '../config';
import { parseSigningKeys } from '../crypto/signing-keys';
import type { SigningKeyRing } from '../crypto/signing-keys';
import { parseCdnResources } from './cdn-resource';
import type { CdnResource } from './cdn-resource';
import { CdnSettings, resolveCdnEffective } from './cdn-settings';
import type { CdnDeploymentLimits, CdnEffective, CdnStoredOverrides } from './cdn-settings';

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

/** `CdnConfig` 讀執行期覆寫的來源（`CdnSettings`；測試可以換成固定的值）。 */
export interface CdnOverridesSource {
  current(): CdnStoredOverrides | undefined;
}

/**
 * CDN 的 **生效值** 只從這裡讀（docs/architecture/backend/09-file.md §16.4、§16.9）：簽章（`CdnUrlSigner`）與清理（`CdnPurger`）
 * 每次都問它，不各自讀環境變數。環境變數是部署層的能力、上限與預設值；平台 DB 的執行期覆寫（`CdnSettings`）在不重啟的情況下
 * 改變 `servesResource` 等方法的結果——所以呼叫端每次都要重新問，不要快取結果。
 *
 * 沒有部署 CDN（`FILE_CDN_ENABLED=false`）時一律「不走 CDN」、不清理，執行期的設定被忽略。
 */
@Injectable()
export class CdnConfig {
  private readonly limits: CdnDeploymentLimits;
  private readonly deploymentValue: CdnDeployment | undefined;
  /** 上一次解析用的列與結果：列沒換（同一個物件）就不重算。 */
  private resolvedFrom: CdnStoredOverrides | undefined | null = null;
  private resolved: CdnEffective | undefined;

  constructor(
    config: ConfigService<Env, true>,
    @Inject(CdnSettings) private readonly overrides: CdnOverridesSource,
  ) {
    const maxUrlTtl = config.get('FILE_CDN_MAX_URL_TTL', { infer: true });
    const purgeBatchSize = config.get('FILE_CDN_PURGE_BATCH_SIZE', { infer: true });
    if (!config.get('FILE_CDN_ENABLED', { infer: true })) {
      this.limits = { resources: new Set(), maxUrlTtl, purgeOnDelete: false, purgeBatchSize };
      return;
    }
    // FILE_CDN_ENABLED=true 時 env.schema.ts 已檢查過格式：這裡解析失敗代表繞過了驗證
    const keys = parseSigningKeys(config.get('FILE_CDN_SIGNING_KEYS', { infer: true }) ?? '');
    const resources = parseCdnResources(config.get('FILE_CDN_RESOURCES', { infer: true }));
    const origin = config.get('FILE_CDN_ORIGIN', { infer: true });
    if (typeof keys === 'string' || typeof resources === 'string' || !origin) {
      throw new Error('FILE_CDN_* 的設定不正確：請檢查環境變數驗證（env.schema.ts）');
    }
    const purgeSecret = config.get('FILE_CDN_PURGE_SECRET', { infer: true });
    this.limits = {
      resources,
      maxUrlTtl,
      purgeOnDelete: config.get('FILE_CDN_PURGE_ON_DELETE', { infer: true }),
      purgeBatchSize,
    };
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

  /** 部署層的能力、上限與預設值（環境變數）。 */
  get deploymentLimits(): CdnDeploymentLimits {
    return this.limits;
  }

  /** 這個程序能不能送清理請求（設定了清理端點與密鑰）。 */
  get canPurge(): boolean {
    return Boolean(this.deploymentValue?.purgeUrl && this.deploymentValue.purgeSecret);
  }

  /** 目前的生效值（環境變數 ＋ 執行期覆寫）；沒有部署 CDN 時是 `undefined`。 */
  effective(): CdnEffective | undefined {
    if (!this.isDeployed) return undefined;
    const stored = this.overrides.current();
    if (this.resolvedFrom !== stored || !this.resolved) {
      this.resolved = resolveCdnEffective(this.limits, stored);
      this.resolvedFrom = stored;
    }
    return this.resolved;
  }

  /** 這種資源現在要不要簽成 CDN 網址：部署了、執行期開著、而且資源類型在生效的清單裡。 */
  servesResource(resource: CdnResource | undefined): boolean {
    if (resource === undefined) return false;
    const effective = this.effective();
    return Boolean(effective?.serving && effective.resources.includes(resource));
  }

  /** CDN 網址效期的上限（秒）。 */
  maxUrlTtl(): number {
    return this.effective()?.urlTtlCap ?? this.limits.maxUrlTtl;
  }

  /** 物件永久刪除後要不要排入清理；與執行期的開關無關：關掉期間發出的網址仍在效期內（§17 D13）。 */
  purgeOnDelete(): boolean {
    return this.effective()?.purgeOnDelete ?? false;
  }

  /** 一筆 `cdn.purge` 最多幾個路徑。 */
  purgeBatchSize(): number {
    return this.effective()?.purgeBatchSize ?? this.limits.purgeBatchSize;
  }
}
