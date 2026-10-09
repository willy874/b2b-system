import { createHmac } from 'node:crypto';

import { requireTenant } from '../tenant';
import { CdnConfig } from './cdn-config';
import type { CdnDeployment } from './cdn-config';
import { stableSigningDate } from './object-storage';
import { ObjectUrlSigner, PresignedUrlSigner } from './object-url-signer';
import type { SignedObjectUrl, SignObjectUrlOptions } from './object-url-signer';

/**
 * 邊緣看到的物件路徑的前綴（docs/architecture/backend/09-file.md §16.2）：與 apps/file-storage 的 `FILE_STORAGE_BASE_PATH`
 * 相同，邊緣回源時路徑原樣轉發。快取的 key、簽章、清理都以 `/storage/<bucket>/<key>` 為準。
 */
export const CDN_PATH_PREFIX = '/storage';

/** 物件在邊緣上的路徑（未編碼）：bucket 一個租戶一個，不同租戶的物件不會共用快取。 */
export function cdnPathOf(bucket: string, key: string): string {
  return `${CDN_PATH_PREFIX}/${bucket}/${key}`;
}

/**
 * `ObjectUrlSigner` 的 CDN 實作（docs/architecture/backend/09-file.md §16.2）。標了 `cdn`、而且 `CdnConfig` 說這種資源
 * 現在走 CDN 的物件簽成 CDN 網址；其他（原檔、下載、還沒開放的資源）交給 presigned。呼叫端不知道自己拿到哪一種。
 *
 * 效期取用途的 `expiresIn` 與 `FILE_CDN_MAX_URL_TTL` 較小者；`exp` 取整到效期一半的時間窗（同 `stableSigningDate`），
 * 同一個時間窗內網址相同，瀏覽器快取照樣命中。邊緣快取的 key 不含簽章，效期長短不影響命中率（§17 D2）。
 *
 * 各家 CDN 的差別只在網址的形狀與簽章（`signedUrl`）：這一版只有 `NginxCdnUrlSigner`，
 * 之後的 CloudFront、Cloudflare 是新的子類別。
 */
export abstract class CdnUrlSigner extends ObjectUrlSigner {
  constructor(
    private readonly presigned: PresignedUrlSigner,
    private readonly config: CdnConfig,
  ) {
    super();
  }

  async sign(key: string, options: SignObjectUrlOptions): Promise<SignedObjectUrl> {
    const deployment = this.config.deployment;
    if (
      !deployment ||
      !this.config.servesResource(options.cdn) ||
      // CDN 網址不帶回應標頭的覆寫：下載與型別政策仍走 presigned（§17 D4）
      options.disposition === 'attachment' ||
      options.contentType !== undefined
    ) {
      return this.presigned.sign(key, options);
    }
    const ttl = Math.min(options.expiresIn, this.config.maxUrlTtl());
    const signedAt = stableSigningDate(Date.now(), ttl).getTime();
    const exp = Math.floor(signedAt / 1000) + ttl;
    const path = cdnPathOf(requireTenant().storageBucket, key);
    return { url: this.signedUrl(deployment, path, exp), expiresAt: new Date(exp * 1000) };
  }

  /** `path` 是未編碼的物件路徑（`cdnPathOf`），`exp` 是 unix 秒。 */
  protected abstract signedUrl(deployment: CdnDeployment, path: string, exp: number): string;
}

/** 簽章的內容：`exp` 與完整路徑（含 bucket）。換路徑、換 bucket、改 `exp` 都驗不過；`kid` 只用來選金鑰。 */
export function nginxCdnSignature(key: Buffer, path: string, exp: number): string {
  return createHmac('sha256', key).update(`${exp}\n${path}`).digest('base64url');
}

/** 每一段各自編碼（`@`、空白等），`/` 保留；邊緣以解碼後的 `$uri` 驗證與當作快取的 key。 */
export function encodeCdnPath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

/**
 * 自架的 nginx 邊緣（deploy/nginx.cdn.conf ＋ deploy/cdn.js）：
 * `<FILE_CDN_ORIGIN>/storage/<bucket>/<key>?exp=<unix 秒>&kid=<金鑰 id>&sig=<base64url(HMAC-SHA256(金鑰, exp + "\n" + 路徑))>`。
 * 金鑰環的第一把簽發，邊緣接受環上的每一把（輪替，§16.3）。由 `StorageModule` 的 factory 建立。
 */
export class NginxCdnUrlSigner extends CdnUrlSigner {
  protected signedUrl(deployment: CdnDeployment, path: string, exp: number): string {
    const { kid, key } = deployment.signingKeys.signing;
    const sig = nginxCdnSignature(key, path, exp);
    return `${deployment.origin}${encodeCdnPath(path)}?exp=${exp}&kid=${encodeURIComponent(kid)}&sig=${sig}`;
  }
}
