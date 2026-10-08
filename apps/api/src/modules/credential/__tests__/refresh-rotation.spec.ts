import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { rotateRefreshToken, secondsUntil } from '../refresh-rotation';
import type { RefreshTokenRecord, RefreshTokenStore, RotationOptions } from '../refresh-rotation';
import { sha256 } from '../token-hash';

const NOW = new Date('2026-10-08T12:00:00.000Z');
const RAW = 'raw-refresh-token';

function record(overrides: Partial<RefreshTokenRecord> = {}): RefreshTokenRecord {
  return {
    id: 'rt-1',
    subjectId: 'u1',
    familyId: 'fam-1',
    familyCreatedAt: new Date(NOW.getTime() - 60 * 60 * 1000),
    tokenHash: sha256(RAW),
    expiresAt: new Date(NOW.getTime() + 60 * 60 * 1000),
    usedAt: null,
    revokedAt: null,
    revokedReason: null,
    clientId: null,
    idpSessionUid: null,
    ...overrides,
  };
}

interface StoreBehavior {
  familyRevoked?: boolean;
  /** `rotate` 的結果；null 代表沒搶到（回 undefined）。 */
  rotated?: string | null;
  /** `supersede` 的結果；null 代表不是家族的上一張（回 undefined）。 */
  superseded?: string | null;
}

function store(row: RefreshTokenRecord | undefined, behavior: StoreBehavior = {}) {
  const rotated = behavior.rotated === undefined ? 'next-raw' : behavior.rotated;
  const superseded = behavior.superseded === undefined ? 'replay-raw' : behavior.superseded;
  return {
    findByHash: vi.fn<RefreshTokenStore['findByHash']>(async () => row),
    isFamilyRevoked: vi.fn<RefreshTokenStore['isFamilyRevoked']>(
      async () => behavior.familyRevoked ?? false,
    ),
    revokeFamily: vi.fn<RefreshTokenStore['revokeFamily']>(async () => undefined),
    rotate: vi.fn<RefreshTokenStore['rotate']>(async () => rotated ?? undefined),
    supersede: vi.fn<RefreshTokenStore['supersede']>(async () => superseded ?? undefined),
  };
}

function options(overrides: Partial<RotationOptions<{ id: string }>> = {}) {
  return {
    ttlSeconds: 3600,
    familyMaxAgeSeconds: 30 * 24 * 3600,
    reuseGraceSeconds: 30,
    meta: { ip: '203.0.113.1', userAgent: 'UA/1' },
    loadSubject: vi.fn(async (id: string) => ({ id })),
    onReuse: vi.fn(async () => undefined),
    onGraceReplay: vi.fn(async () => undefined),
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('secondsUntil（cookie 的 Max-Age）', () => {
  it('回傳無條件進位的剩餘秒數', () => {
    expect(secondsUntil(new Date(NOW.getTime() + 1500))).toBe(2);
  });

  it('已過期回 0，不回負數', () => {
    expect(secondsUntil(new Date(NOW.getTime() - 10_000))).toBe(0);
  });
});

describe('rotateRefreshToken（docs/architecture/backend/04-auth.md §2、07-testing §8 認證）', () => {
  it('找不到 token → AUTH_REFRESH_INVALID', async () => {
    const s = store(undefined);
    await expect(rotateRefreshToken(s, RAW, options())).rejects.toMatchObject({
      code: 'AUTH_REFRESH_INVALID',
    });
    expect(s.findByHash).toHaveBeenCalledWith(sha256(RAW));
  });

  describe('輪替（§8：refresh token 輪替）', () => {
    it('未使用的 token → 標記使用並在同一家族發下一張，帶請求的 IP 與 UA', async () => {
      const row = record();
      const s = store(row);
      const opts = options();
      const result = await rotateRefreshToken(s, RAW, opts);
      const expiresAt = new Date(NOW.getTime() + 3600 * 1000);
      expect(result).toEqual({ row, subject: { id: 'u1' }, raw: 'next-raw', expiresAt });
      expect(opts.loadSubject).toHaveBeenCalledWith('u1');
      expect(s.rotate).toHaveBeenCalledWith(row, {
        expiresAt,
        userAgent: 'UA/1',
        ipAddress: '203.0.113.1',
      });
      expect(s.revokeFamily).not.toHaveBeenCalled();
    });

    it('下一張的到期時間不超過家族的絕對壽命', async () => {
      const row = record({ familyCreatedAt: new Date(NOW.getTime() - 59 * 60 * 1000) });
      const s = store(row);
      const result = await rotateRefreshToken(
        s,
        RAW,
        options({ familyMaxAgeSeconds: 3600, meta: {} }),
      );
      const familyEnd = new Date(NOW.getTime() + 60 * 1000);
      expect(result.expiresAt).toEqual(familyEnd);
      expect(s.rotate).toHaveBeenCalledWith(row, {
        expiresAt: familyEnd,
        userAgent: null,
        ipAddress: null,
      });
    });

    it('主人不能用（loadSubject 拋錯）→ 錯誤原樣拋出，不輪替', async () => {
      const s = store(record());
      const error = new Error('AUTH_TOKEN_STALE');
      const opts = options({ loadSubject: vi.fn(async () => Promise.reject(error)) });
      await expect(rotateRefreshToken(s, RAW, opts)).rejects.toBe(error);
      expect(s.rotate).not.toHaveBeenCalled();
    });
  });

  describe('過期', () => {
    it('token 本身已過期 → AUTH_REFRESH_EXPIRED', async () => {
      const s = store(record({ expiresAt: new Date(NOW.getTime() - 1) }));
      await expect(rotateRefreshToken(s, RAW, options())).rejects.toMatchObject({
        code: 'AUTH_REFRESH_EXPIRED',
      });
      expect(s.rotate).not.toHaveBeenCalled();
    });

    it('家族超過絕對壽命 → AUTH_REFRESH_EXPIRED（即使 token 還沒到期）', async () => {
      const s = store(record({ familyCreatedAt: new Date(NOW.getTime() - 3600 * 1000) }));
      await expect(
        rotateRefreshToken(s, RAW, options({ familyMaxAgeSeconds: 3600 })),
      ).rejects.toMatchObject({ code: 'AUTH_REFRESH_EXPIRED' });
    });
  });

  describe('已撤銷', () => {
    it('token 已撤銷且從未使用 → AUTH_REFRESH_REVOKED，不撤銷家族', async () => {
      const row = record({ revokedAt: new Date(NOW.getTime() - 1000) });
      const s = store(row);
      s.findByHash.mockResolvedValueOnce(row).mockResolvedValueOnce(row);
      await expect(rotateRefreshToken(s, RAW, options())).rejects.toMatchObject({
        code: 'AUTH_REFRESH_REVOKED',
      });
      expect(s.revokeFamily).not.toHaveBeenCalled();
      expect(s.isFamilyRevoked).not.toHaveBeenCalled();
    });

    it('家族裡有別張被撤銷（登出與續期同時提交）→ AUTH_REFRESH_REVOKED', async () => {
      const row = record();
      const s = store(row, { familyRevoked: true });
      s.findByHash.mockResolvedValueOnce(row).mockResolvedValueOnce(undefined);
      await expect(rotateRefreshToken(s, RAW, options())).rejects.toMatchObject({
        code: 'AUTH_REFRESH_REVOKED',
      });
      expect(s.isFamilyRevoked).toHaveBeenCalledWith('fam-1');
    });

    it('已撤銷而且已被用過 → 判定為重用：撤銷家族並通知 → AUTH_REFRESH_REUSED', async () => {
      const row = record({
        revokedAt: new Date(NOW.getTime() - 1000),
        usedAt: new Date(NOW.getTime() - 2000),
      });
      const s = store(row);
      const opts = options();
      await expect(rotateRefreshToken(s, RAW, opts)).rejects.toMatchObject({
        code: 'AUTH_REFRESH_REUSED',
      });
      expect(s.revokeFamily).toHaveBeenCalledWith('fam-1', 'reuse_detected');
      expect(opts.onReuse).toHaveBeenCalledWith(row);
    });

    it('請求開始時未使用、但併發請求已用掉後家族被撤銷 → 重讀 used_at，判定為重用', async () => {
      const row = record({ revokedAt: new Date(NOW.getTime() - 1000) });
      const s = store(row);
      s.findByHash
        .mockResolvedValueOnce(row)
        .mockResolvedValueOnce({ ...row, usedAt: new Date(NOW.getTime() - 500) });
      await expect(rotateRefreshToken(s, RAW, options())).rejects.toMatchObject({
        code: 'AUTH_REFRESH_REUSED',
      });
      expect(s.findByHash).toHaveBeenLastCalledWith(row.tokenHash);
      expect(s.revokeFamily).toHaveBeenCalledWith('fam-1', 'reuse_detected');
    });
  });

  describe('重用偵測（§8：refresh token 重用 → 整條家族撤銷）', () => {
    it('用過的 token 超過寬限期再出示 → 撤銷整條家族、呼叫 onReuse → AUTH_REFRESH_REUSED', async () => {
      const row = record({ usedAt: new Date(NOW.getTime() - 31_000) });
      const s = store(row);
      const opts = options();
      await expect(rotateRefreshToken(s, RAW, opts)).rejects.toMatchObject({
        code: 'AUTH_REFRESH_REUSED',
      });
      expect(s.revokeFamily).toHaveBeenCalledWith('fam-1', 'reuse_detected');
      expect(opts.onReuse).toHaveBeenCalledWith(row);
      expect(s.supersede).not.toHaveBeenCalled();
      expect(opts.loadSubject).not.toHaveBeenCalled();
    });

    it('寬限期為 0 時，用過的 token 一律是重用', async () => {
      const row = record({ usedAt: new Date(NOW.getTime() - 1) });
      const s = store(row);
      await expect(
        rotateRefreshToken(s, RAW, options({ reuseGraceSeconds: 0 })),
      ).rejects.toMatchObject({ code: 'AUTH_REFRESH_REUSED' });
      expect(s.revokeFamily).toHaveBeenCalledWith('fam-1', 'reuse_detected');
    });

    it('寬限期內但不是家族的上一張（supersede 失敗）→ 重用', async () => {
      const row = record({ usedAt: new Date(NOW.getTime() - 5_000) });
      const s = store(row, { superseded: null });
      const opts = options();
      await expect(rotateRefreshToken(s, RAW, opts)).rejects.toMatchObject({
        code: 'AUTH_REFRESH_REUSED',
      });
      expect(s.revokeFamily).toHaveBeenCalledWith('fam-1', 'reuse_detected');
      expect(opts.onGraceReplay).not.toHaveBeenCalled();
    });
  });

  describe('寬限期內的重送（回應在路上遺失）', () => {
    it('換發一張新的、不撤銷家族，呼叫 onGraceReplay', async () => {
      const row = record({ usedAt: new Date(NOW.getTime() - 30_000) });
      const s = store(row);
      const opts = options();
      const result = await rotateRefreshToken(s, RAW, opts);
      expect(result).toEqual({
        row,
        subject: { id: 'u1' },
        raw: 'replay-raw',
        expiresAt: new Date(NOW.getTime() + 3600 * 1000),
      });
      expect(s.supersede).toHaveBeenCalledWith(
        row,
        expect.objectContaining({ ipAddress: '203.0.113.1' }),
      );
      expect(s.rotate).not.toHaveBeenCalled();
      expect(s.revokeFamily).not.toHaveBeenCalled();
      expect(opts.onGraceReplay).toHaveBeenCalledWith(row);
    });

    it('沒有 onGraceReplay 也能換發', async () => {
      const row = record({ usedAt: new Date(NOW.getTime() - 1_000) });
      const s = store(row);
      const result = await rotateRefreshToken(s, RAW, options({ onGraceReplay: undefined }));
      expect(result.raw).toBe('replay-raw');
    });
  });

  describe('併發：rotate 沒搶到', () => {
    it('被併發的請求用掉、仍在寬限期內 → 走重送換發', async () => {
      const row = record();
      const s = store(row, { rotated: null });
      s.findByHash
        .mockResolvedValueOnce(row)
        .mockResolvedValueOnce({ ...row, usedAt: new Date(NOW.getTime() - 100) });
      const opts = options();
      const result = await rotateRefreshToken(s, RAW, opts);
      expect(result.raw).toBe('replay-raw');
      expect(s.supersede).toHaveBeenCalledTimes(1);
      expect(opts.onGraceReplay).toHaveBeenCalledWith(row);
    });

    it('被併發的請求用掉、超過寬限期 → 重用', async () => {
      const row = record();
      const s = store(row, { rotated: null });
      s.findByHash
        .mockResolvedValueOnce(row)
        .mockResolvedValueOnce({ ...row, usedAt: new Date(NOW.getTime() - 100) });
      await expect(
        rotateRefreshToken(s, RAW, options({ reuseGraceSeconds: 0 })),
      ).rejects.toMatchObject({ code: 'AUTH_REFRESH_REUSED' });
      expect(s.revokeFamily).toHaveBeenCalledWith('fam-1', 'reuse_detected');
    });

    it('沒被用掉而是被撤銷（同時登出）→ AUTH_REFRESH_REVOKED', async () => {
      const row = record();
      const s = store(row, { rotated: null });
      await expect(rotateRefreshToken(s, RAW, options())).rejects.toMatchObject({
        code: 'AUTH_REFRESH_REVOKED',
      });
      expect(s.revokeFamily).not.toHaveBeenCalled();
    });
  });
});
