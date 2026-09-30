import { AppException } from '@/core/errors';
import type { RevokedReason } from '@/db/schema';

import type { RequestMeta } from './auth.service';
import { sha256 } from './token-hash';

/** cookie 的 Max-Age：新 token 的剩餘秒數（可能被家族的絕對壽命截短）。 */
export function secondsUntil(date: Date): number {
  return Math.max(0, Math.ceil((date.getTime() - Date.now()) / 1000));
}

/** 一張 refresh token 在輪替時需要的欄位（租戶的 `refresh_tokens`、平台的 `platform_refresh_tokens` 共用）。 */
export interface RefreshTokenRecord {
  id: string;
  /** 使用者或平台管理者的 id。 */
  subjectId: string;
  familyId: string;
  /** 家族（這次登入）建立的時間：絕對壽命由它起算，輪替時沿用。 */
  familyCreatedAt: Date;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
  revokedAt: Date | null;
  revokedReason: string | null;
  clientId: string | null;
  idpSessionUid: string | null;
}

/** 發下一張時的參數；`expiresAt` 已經以家族的絕對壽命截短過。 */
export interface NextRefreshToken {
  expiresAt: Date;
  userAgent: string | null;
  ipAddress: string | null;
}

/** refresh token 的儲存；租戶與平台各有一份實作，輪替規則只有 `rotateRefreshToken` 這一套。 */
export interface RefreshTokenStore {
  findByHash(hash: string): Promise<RefreshTokenRecord | undefined>;
  /**
   * 家族是否已被撤銷：有任何一張因登出、重用偵測、停用等原因被撤銷（撤銷一律以家族或使用者為單位）。
   * 寬限期內被取代（`superseded`）的那張不算。
   */
  isFamilyRevoked(familyId: string): Promise<boolean>;
  revokeFamily(familyId: string, reason: RevokedReason): Promise<void>;
  /**
   * 同一個交易內：條件式地把 `row` 標成已使用（尚未使用、尚未撤銷才成功），成功才在同一個家族發下一張。
   * 回傳新 token 的原文；沒搶到（被併發的請求用掉或撤銷）回 undefined。
   */
  rotate(row: RefreshTokenRecord, next: NextRefreshToken): Promise<string | undefined>;
  /**
   * 寬限期內重送「上一張」：同一個交易內鎖住 `row`，確認它是家族裡最後被使用的那張，把家族目前的最新一張
   * （尚未使用、尚未撤銷）標成 `superseded`，再發一張新的。任一條件不成立回 undefined（交給呼叫端判定為重用）。
   */
  supersede(row: RefreshTokenRecord, next: NextRefreshToken): Promise<string | undefined>;
}

export interface RotationOptions<TSubject> {
  ttlSeconds: number;
  /** 家族的絕對壽命（秒）：從登入起算，超過就要重新登入，不論期間續期了幾次。 */
  familyMaxAgeSeconds: number;
  /**
   * 重送寬限期（秒）：用過的 token 在被使用後這段時間內再出示，而且它就是家族的上一張，視為「回應在路上遺失」
   * 而不是竊用——換發一張新的、不撤銷家族。0 停用。
   */
  reuseGraceSeconds: number;
  meta: RequestMeta;
  /** 載入 token 的主人並檢查還能不能用；不能用時拋 `AppException`。 */
  loadSubject: (subjectId: string) => Promise<TSubject>;
  /** 偵測到重用：整條家族已撤銷，由呼叫端寫高嚴重度稽核。 */
  onReuse: (row: RefreshTokenRecord) => Promise<void>;
  /** 寬限期內的重送：已換發新的一張，由呼叫端寫一般嚴重度的稽核。 */
  onGraceReplay?: (row: RefreshTokenRecord) => Promise<void>;
}

/**
 * refresh token 輪替（docs/architecture/backend/04-auth.md §2）：一次性使用、重用偵測、併發請求只有一個成功、
 * 家族的絕對壽命，以及回應遺失時的重送寬限期。租戶的 app session 與平台管理者的 session 共用這一套規則。
 */
export async function rotateRefreshToken<TSubject>(
  store: RefreshTokenStore,
  rawToken: string,
  options: RotationOptions<TSubject>,
): Promise<{ row: RefreshTokenRecord; subject: TSubject; raw: string; expiresAt: Date }> {
  const row = await store.findByHash(sha256(rawToken));
  if (!row) throw new AppException('AUTH_REFRESH_INVALID');

  const rejectReuse = async (): Promise<never> => {
    await store.revokeFamily(row.familyId, 'reuse_detected');
    await options.onReuse(row);
    throw new AppException('AUTH_REFRESH_REUSED');
  };
  /** 讀取當下的 `used_at`：`row` 是請求一開始讀到的，併發請求可能已經把它用掉。 */
  const latestUsedAt = async (): Promise<Date | null> => {
    if (row.usedAt) return row.usedAt;
    return (await store.findByHash(row.tokenHash))?.usedAt ?? null;
  };
  const familyExpiresAt = new Date(
    row.familyCreatedAt.getTime() + options.familyMaxAgeSeconds * 1000,
  );
  const next: NextRefreshToken = {
    // 不超過家族的絕對壽命
    expiresAt: new Date(
      Math.min(Date.now() + options.ttlSeconds * 1000, familyExpiresAt.getTime()),
    ),
    userAgent: options.meta.userAgent ?? null,
    ipAddress: options.meta.ip ?? null,
  };
  /** 用過的 token 再出示：寬限期內、而且它是上一張 → 換發；否則是重用。 */
  const replay = async (usedAt: Date): Promise<{ subject: TSubject; raw: string }> => {
    const withinGrace = Date.now() - usedAt.getTime() <= options.reuseGraceSeconds * 1000;
    if (!withinGrace) return rejectReuse();
    const subject = await options.loadSubject(row.subjectId);
    const raw = await store.supersede(row, next);
    if (raw === undefined) return rejectReuse();
    await options.onGraceReplay?.(row);
    return { subject, raw };
  };

  // 也看整個家族：登出與續期同時提交時，續期新發的那張可能沒被撤銷到
  if (row.revokedAt || (await store.isFamilyRevoked(row.familyId))) {
    // 已被用過的 token 再出示就是重用，即使家族已被撤銷：同一張 token 的併發請求裡，
    // 先失敗的那個已撤銷整條家族，後到的仍要判定為重用（04-auth.md §2.3）
    if (await latestUsedAt()) return rejectReuse();
    throw new AppException('AUTH_REFRESH_REVOKED');
  }
  if (row.expiresAt.getTime() < Date.now() || familyExpiresAt.getTime() <= Date.now()) {
    throw new AppException('AUTH_REFRESH_EXPIRED');
  }
  if (row.usedAt) return { row, expiresAt: next.expiresAt, ...(await replay(row.usedAt)) };

  const subject = await options.loadSubject(row.subjectId);

  // markUsed 與發下一張必須同一個交易，否則使用者會被無故登出
  const raw = await store.rotate(row, next);
  if (raw === undefined) {
    // 沒搶到：被另一個請求用掉 → 重送（寬限期內）或重用；沒被用掉而是被撤銷（例：同時登出）→ 撤銷
    const usedAt = await latestUsedAt();
    if (usedAt) return { row, expiresAt: next.expiresAt, ...(await replay(usedAt)) };
    throw new AppException('AUTH_REFRESH_REVOKED');
  }
  return { row, subject, raw, expiresAt: next.expiresAt };
}
