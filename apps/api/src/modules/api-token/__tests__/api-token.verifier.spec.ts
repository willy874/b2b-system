import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { formatToken } from '@/common/auth';
import type { AccessTokenVerifier } from '@/common/auth';
import type { ApiTokenCacheService, CachedApiToken, CachedUser } from '@/core/cache';
import { runInTenantContext } from '@/core/tenant';
import type { TenantContext } from '@/core/tenant';
import type { ApiTokenRow } from '@/db/schema';
import { sha256 } from '@/modules/credential/token-hash';

import type { ApiTokenRepository } from '../api-token.repository';
import { ApiTokenVerifier } from '../api-token.verifier';

const NOW = new Date('2026-10-06T00:00:00.000Z');
const TOKEN_ID = '44444444-4444-4444-8444-444444444444';
const USER_ID = '11111111-1111-4111-8111-111111111111';
const SECRET = 'S3cretS3cretS3cretS3cretS3cretS3cret';
const RAW = formatToken('acme', TOKEN_ID, SECRET);

const USER: CachedUser = {
  id: USER_ID,
  email: 'alice@example.com',
  status: 'active',
  tokenVersion: 3,
  deletedAt: null,
};

function row(overrides: Partial<ApiTokenRow> = {}): ApiTokenRow {
  return {
    id: TOKEN_ID,
    userId: USER_ID,
    name: 'CI',
    prefix: 'b2bt_acme_x_S3cr',
    secretHash: sha256(SECRET),
    scopes: null,
    accountVersion: 3,
    expiresAt: new Date(NOW.getTime() + 60_000),
    lastUsedAt: null,
    revokedAt: null,
    revokedBy: null,
    createdAt: NOW,
    createdBy: USER_ID,
    ...overrides,
  };
}

/** `null`＝資料庫裡沒有這把 token。 */
function setup(stored: ApiTokenRow | null = row()) {
  const order: string[] = [];
  const repo = {
    findForVerification: vi.fn(async (_id: string) => {
      order.push('repo:find');
      return stored ?? undefined;
    }),
  };
  const cache = {
    get: vi.fn((_id: string): CachedApiToken | undefined => undefined),
    ticket: vi.fn(() => {
      order.push('cache:ticket');
      return 7;
    }),
    set: vi.fn((_token: CachedApiToken, _ticket: number) => undefined),
  };
  const accounts = {
    checkUser: vi.fn(async (_userId: string, _version: number) => ({
      ok: true as const,
      user: USER,
    })),
  };
  const verifier = new ApiTokenVerifier(
    repo as unknown as ApiTokenRepository,
    cache as unknown as ApiTokenCacheService,
    accounts as unknown as AccessTokenVerifier,
  );
  return { verifier, repo, cache, accounts, order };
}

function inTenant<T>(fn: () => Promise<T>, code = 'acme'): Promise<T> {
  return runInTenantContext({ id: 't1', code } as unknown as TenantContext, fn);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: NOW });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ApiTokenVerifier.verify 的格式與租戶（docs/architecture/06-external-api.md §9.2 D7）', () => {
  it('沒帶 token → AUTH_TOKEN_INVALID，不查資料庫', async () => {
    const ctx = setup();
    await expect(inTenant(() => ctx.verifier.verify(undefined))).resolves.toEqual({
      ok: false,
      code: 'AUTH_TOKEN_INVALID',
    });
    expect(ctx.repo.findForVerification).not.toHaveBeenCalled();
  });

  it('格式不對（例：JWT）→ AUTH_TOKEN_INVALID，不查資料庫', async () => {
    const ctx = setup();
    const result = await inTenant(() => ctx.verifier.verify('eyJhbGciOiJIUzI1NiJ9.e30.sig'));
    expect(result).toEqual({ ok: false, code: 'AUTH_TOKEN_INVALID' });
    expect(ctx.repo.findForVerification).not.toHaveBeenCalled();
  });

  it('不在租戶脈絡裡（代碼找不到租戶）→ AUTH_TOKEN_INVALID', async () => {
    const ctx = setup();
    await expect(ctx.verifier.verify(RAW)).resolves.toEqual({
      ok: false,
      code: 'AUTH_TOKEN_INVALID',
    });
    expect(ctx.repo.findForVerification).not.toHaveBeenCalled();
  });

  it('token 的租戶代碼與目前租戶不同 → AUTH_TOKEN_INVALID，不查資料庫', async () => {
    const ctx = setup();
    const result = await inTenant(() => ctx.verifier.verify(RAW), 'beta');
    expect(result).toEqual({ ok: false, code: 'AUTH_TOKEN_INVALID' });
    expect(ctx.repo.findForVerification).not.toHaveBeenCalled();
  });
});

describe('ApiTokenVerifier.verify 的 token 判定（docs/architecture/06-external-api.md §9.2 D5、D7）', () => {
  it('有效的 token：回傳帳號與 token，以解析出的 id 查詢', async () => {
    const ctx = setup();
    const result = await inTenant(() => ctx.verifier.verify(RAW));
    expect(ctx.repo.findForVerification).toHaveBeenCalledWith(TOKEN_ID);
    expect(result).toEqual({
      ok: true,
      user: USER,
      token: { id: TOKEN_ID, expiresAt: row().expiresAt },
    });
  });

  it('找不到 → AUTH_TOKEN_INVALID', async () => {
    const ctx = setup(null);
    await expect(inTenant(() => ctx.verifier.verify(RAW))).resolves.toEqual({
      ok: false,
      code: 'AUTH_TOKEN_INVALID',
    });
  });

  it('secret 不符 → AUTH_TOKEN_INVALID（與找不到同一個錯誤，不透露 id 是否存在）', async () => {
    const ctx = setup();
    const forged = formatToken('acme', TOKEN_ID, 'WrongWrongWrongWrongWrong');
    await expect(inTenant(() => ctx.verifier.verify(forged))).resolves.toEqual({
      ok: false,
      code: 'AUTH_TOKEN_INVALID',
    });
  });

  it('存的雜湊長度不對（資料損毀）→ AUTH_TOKEN_INVALID，不拋例外', async () => {
    const ctx = setup(row({ secretHash: 'abcd' }));
    await expect(inTenant(() => ctx.verifier.verify(RAW))).resolves.toEqual({
      ok: false,
      code: 'AUTH_TOKEN_INVALID',
    });
  });

  it('已撤銷 → AUTH_TOKEN_INVALID', async () => {
    const ctx = setup(row({ revokedAt: NOW }));
    await expect(inTenant(() => ctx.verifier.verify(RAW))).resolves.toEqual({
      ok: false,
      code: 'AUTH_TOKEN_INVALID',
    });
  });

  it('已撤銷又已過期：仍回 AUTH_TOKEN_INVALID（撤銷優先）', async () => {
    const ctx = setup(row({ revokedAt: NOW, expiresAt: new Date(0) }));
    await expect(inTenant(() => ctx.verifier.verify(RAW))).resolves.toEqual({
      ok: false,
      code: 'AUTH_TOKEN_INVALID',
    });
  });

  it('secret 不符但 token 已過期：回 AUTH_TOKEN_INVALID，不透露它過期了', async () => {
    const ctx = setup(row({ expiresAt: new Date(0) }));
    const forged = formatToken('acme', TOKEN_ID, 'WrongWrongWrongWrongWrong');
    await expect(inTenant(() => ctx.verifier.verify(forged))).resolves.toEqual({
      ok: false,
      code: 'AUTH_TOKEN_INVALID',
    });
  });

  it('到期時間正好是現在 → AUTH_API_TOKEN_EXPIRED，不查帳號', async () => {
    const ctx = setup(row({ expiresAt: NOW }));
    await expect(inTenant(() => ctx.verifier.verify(RAW))).resolves.toEqual({
      ok: false,
      code: 'AUTH_API_TOKEN_EXPIRED',
    });
    expect(ctx.accounts.checkUser).not.toHaveBeenCalled();
  });

  it('到期前一毫秒：仍有效', async () => {
    const ctx = setup(row({ expiresAt: new Date(NOW.getTime() + 1) }));
    const result = await inTenant(() => ctx.verifier.verify(RAW));
    expect(result.ok).toBe(true);
  });
});

describe('ApiTokenVerifier.verify 的帳號檢查（docs/architecture/06-external-api.md §9.2 D5）', () => {
  it('以 token 記下的 account_version 檢查帳號', async () => {
    const ctx = setup(row({ accountVersion: 9 }));
    await inTenant(() => ctx.verifier.verify(RAW));
    expect(ctx.accounts.checkUser).toHaveBeenCalledWith(USER_ID, 9);
  });

  it.each(['AUTH_TOKEN_STALE', 'AUTH_ACCOUNT_DISABLED', 'AUTH_TOKEN_INVALID'] as const)(
    '帳號檢查失敗（%s）：原樣回傳錯誤碼',
    async (code) => {
      const ctx = setup();
      ctx.accounts.checkUser.mockResolvedValue({ ok: false, code } as never);
      await expect(inTenant(() => ctx.verifier.verify(RAW))).resolves.toEqual({
        ok: false,
        code,
      });
    },
  );
});

describe('ApiTokenVerifier.verify 的 scopes（docs/architecture/06-external-api.md §9.2 D3）', () => {
  it('scopes 是 null：結果沒有 scopes（跟著帳號）', async () => {
    const ctx = setup(row({ scopes: null }));
    const result = await inTenant(() => ctx.verifier.verify(RAW));
    expect(result.ok && 'scopes' in result.token).toBe(false);
  });

  it('有 scopes：展開成含依賴樹的閉包', async () => {
    const ctx = setup(row({ scopes: ['user:update'] }));
    const result = await inTenant(() => ctx.verifier.verify(RAW));
    expect(result.ok ? [...(result.token.scopes ?? [])].toSorted() : undefined).toEqual([
      'user:read',
      'user:resetPassword',
      'user:update',
    ]);
  });

  it('目錄已移除的鍵被濾掉；全部被濾掉時是空集合（沒有任何權限，不是跟著帳號）', async () => {
    const ctx = setup(row({ scopes: ['legacy:gone'] }));
    const result = await inTenant(() => ctx.verifier.verify(RAW));
    expect(result.ok ? result.token.scopes : undefined).toEqual(new Set());
  });
});

describe('ApiTokenVerifier 的驗證快取（docs/architecture/06-external-api.md §9.2 D17）', () => {
  it('快取命中：不查資料庫', async () => {
    const ctx = setup();
    const { name: _name, prefix: _prefix, ...cached } = row();
    ctx.cache.get.mockReturnValue(cached);
    const result = await inTenant(() => ctx.verifier.verify(RAW));
    expect(result.ok).toBe(true);
    expect(ctx.cache.get).toHaveBeenCalledWith(TOKEN_ID);
    expect(ctx.repo.findForVerification).not.toHaveBeenCalled();
  });

  it('快取命中的 token 已撤銷：仍以快取的內容判定', async () => {
    const ctx = setup();
    ctx.cache.get.mockReturnValue({ ...row(), revokedAt: NOW });
    await expect(inTenant(() => ctx.verifier.verify(RAW))).resolves.toEqual({
      ok: false,
      code: 'AUTH_TOKEN_INVALID',
    });
  });

  it('快取沒有：查詢前先取票，查到後以那張票寫入快取（只存驗證需要的欄位）', async () => {
    const ctx = setup(row({ scopes: ['role:read'] }));
    await inTenant(() => ctx.verifier.verify(RAW));
    expect(ctx.order).toEqual(['cache:ticket', 'repo:find']);
    expect(ctx.cache.set).toHaveBeenCalledWith(
      {
        id: TOKEN_ID,
        userId: USER_ID,
        secretHash: sha256(SECRET),
        scopes: ['role:read'],
        accountVersion: 3,
        expiresAt: row().expiresAt,
        revokedAt: null,
      },
      7,
    );
  });

  it('查不到：不寫入快取', async () => {
    const ctx = setup(null);
    await inTenant(() => ctx.verifier.verify(RAW));
    expect(ctx.cache.set).not.toHaveBeenCalled();
  });
});
