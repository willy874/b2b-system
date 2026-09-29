import { AppException } from '@/core/errors';
import type { RevokedReason } from '@/db/schema';

import type { RequestMeta } from './auth.service';
import { sha256 } from './token-hash';

/** 一張 refresh token 在輪替時需要的欄位（租戶的 `refresh_tokens`、平台的 `platform_refresh_tokens` 共用）。 */
export interface RefreshTokenRecord {
  id: string;
  /** 使用者或平台管理者的 id。 */
  subjectId: string;
  familyId: string;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
  revokedAt: Date | null;
  clientId: string | null;
  idpSessionUid: string | null;
}

/** refresh token 的儲存；租戶與平台各有一份實作，輪替規則只有 `rotateRefreshToken` 這一套。 */
export interface RefreshTokenStore {
  findByHash(hash: string): Promise<RefreshTokenRecord | undefined>;
  /** 家族裡是否有任何一張已被撤銷（撤銷一律以家族或使用者為單位）。 */
  isFamilyRevoked(familyId: string): Promise<boolean>;
  revokeFamily(familyId: string, reason: RevokedReason): Promise<void>;
  /**
   * 同一個交易內：條件式地把 `row` 標成已使用（尚未使用、尚未撤銷才成功），成功才在同一個家族發下一張。
   * 回傳新 token 的原文；沒搶到（被併發的請求用掉或撤銷）回 undefined。
   */
  rotate(
    row: RefreshTokenRecord,
    next: { ttlSeconds: number; userAgent: string | null; ipAddress: string | null },
  ): Promise<string | undefined>;
}

export interface RotationOptions<TSubject> {
  ttlSeconds: number;
  meta: RequestMeta;
  /** 載入 token 的主人並檢查還能不能用；不能用時拋 `AppException`。 */
  loadSubject: (subjectId: string) => Promise<TSubject>;
  /** 偵測到重用：整條家族已撤銷，由呼叫端寫高嚴重度稽核。 */
  onReuse: (row: RefreshTokenRecord) => Promise<void>;
}

/**
 * refresh token 輪替（docs/architecture/backend/04-auth.md §2）：一次性使用、重用偵測、併發請求只有一個成功。
 * 租戶的 app session 與平台管理者的 session 共用這一套規則。
 */
export async function rotateRefreshToken<TSubject>(
  store: RefreshTokenStore,
  rawToken: string,
  options: RotationOptions<TSubject>,
): Promise<{ row: RefreshTokenRecord; subject: TSubject; raw: string }> {
  const row = await store.findByHash(sha256(rawToken));
  if (!row) throw new AppException('AUTH_REFRESH_INVALID');

  const rejectReuse = async (): Promise<never> => {
    await store.revokeFamily(row.familyId, 'reuse_detected');
    await options.onReuse(row);
    throw new AppException('AUTH_REFRESH_REUSED');
  };
  /** 讀取當下的狀態：`row` 是請求一開始讀到的，併發請求可能已經把它用掉。 */
  const wasUsed = async (): Promise<boolean> => {
    if (row.usedAt) return true;
    const latest = await store.findByHash(row.tokenHash);
    return Boolean(latest?.usedAt);
  };

  // 也看整個家族：登出與續期同時提交時，續期新發的那張可能沒被撤銷到
  if (row.revokedAt || (await store.isFamilyRevoked(row.familyId))) {
    // 已被用過的 token 再出示就是重用，即使家族已被撤銷：同一張 token 的併發請求裡，
    // 先失敗的那個已撤銷整條家族，後到的仍要判定為重用（04-auth.md §2.3）
    if (await wasUsed()) return rejectReuse();
    throw new AppException('AUTH_REFRESH_REVOKED');
  }
  if (row.expiresAt.getTime() < Date.now()) throw new AppException('AUTH_REFRESH_EXPIRED');
  if (row.usedAt) return rejectReuse();

  const subject = await options.loadSubject(row.subjectId);

  // markUsed 與發下一張必須同一個交易，否則使用者會被無故登出
  const raw = await store.rotate(row, {
    ttlSeconds: options.ttlSeconds,
    userAgent: options.meta.userAgent ?? null,
    ipAddress: options.meta.ip ?? null,
  });
  if (raw === undefined) {
    // 沒搶到：被另一個請求用掉 → 重用；沒被用掉而是被撤銷（例：同時登出）→ 撤銷
    if (await wasUsed()) return rejectReuse();
    throw new AppException('AUTH_REFRESH_REVOKED');
  }
  return { row, subject, raw };
}
