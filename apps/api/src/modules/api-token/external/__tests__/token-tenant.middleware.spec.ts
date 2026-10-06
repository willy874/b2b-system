import type { NextFunction, Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';

import { formatToken } from '@/common/auth';
import { AppException } from '@/core/errors';
import { currentTenant } from '@/core/tenant';
import type { Tenancy, TenantContext, TenantDirectory, TenantRecord } from '@/core/tenant';

import { TokenTenantMiddleware } from '../token-tenant.middleware';

const TOKEN = formatToken(
  'acme',
  '44444444-4444-4444-8444-444444444444',
  'S3cretS3cretS3cretS3cretS3cretS3cret',
);
const ACME = { id: 't1', code: 'acme', status: 'active' } as unknown as TenantRecord;
const ACME_CONTEXT = { id: 't1', code: 'acme' } as unknown as TenantContext;

function setup() {
  const directory = {
    findByCode: vi.fn(async (code: string) => (code === 'acme' ? ACME : undefined)),
  };
  const tenancy = { enter: vi.fn(async (_tenant: TenantRecord) => ACME_CONTEXT) };
  const middleware = new TokenTenantMiddleware(
    directory as unknown as TenantDirectory,
    tenancy as unknown as Tenancy,
  );
  /** next() 被呼叫時所在的租戶脈絡（undefined＝沒有進入任何租戶）。 */
  const seen: Array<TenantContext | undefined> = [];
  const next = vi.fn(() => {
    seen.push(currentTenant());
  });
  const use = (authorization?: string) =>
    middleware.use(
      { headers: authorization ? { authorization } : {} } as Request,
      {} as Response,
      next as unknown as NextFunction,
    );
  return { use, directory, tenancy, next, seen };
}

describe('TokenTenantMiddleware（以 token 的租戶代碼決定租戶，docs/architecture/06-external-api.md §9.2 D7、D9）', () => {
  it('token 的代碼對得到租戶：進入那個租戶後再往下執行', async () => {
    const ctx = setup();
    await ctx.use(`Bearer ${TOKEN}`);
    expect(ctx.directory.findByCode).toHaveBeenCalledWith('acme');
    expect(ctx.tenancy.enter).toHaveBeenCalledWith(ACME);
    expect(ctx.seen).toEqual([ACME_CONTEXT]);
  });

  it('沒帶 token：不查租戶、不擋，在沒有租戶的脈絡下往下執行（健康檢查）', async () => {
    const ctx = setup();
    await ctx.use();
    expect(ctx.directory.findByCode).not.toHaveBeenCalled();
    expect(ctx.seen).toEqual([undefined]);
  });

  it('不是 Bearer：當成沒帶 token', async () => {
    const ctx = setup();
    await ctx.use(`Basic ${TOKEN}`);
    expect(ctx.directory.findByCode).not.toHaveBeenCalled();
    expect(ctx.seen).toEqual([undefined]);
  });

  it('格式不對（例：JWT）：不查租戶、不擋（由認證 guard 回 401）', async () => {
    const ctx = setup();
    await ctx.use('Bearer eyJhbGciOiJIUzI1NiJ9.e30.sig');
    expect(ctx.directory.findByCode).not.toHaveBeenCalled();
    expect(ctx.seen).toEqual([undefined]);
  });

  it('代碼找不到租戶：不擋，不進入任何租戶', async () => {
    const ctx = setup();
    const unknown = TOKEN.replace('b2bt_acme_', 'b2bt_ghost_');
    await ctx.use(`Bearer ${unknown}`);
    expect(ctx.directory.findByCode).toHaveBeenCalledWith('ghost');
    expect(ctx.tenancy.enter).not.toHaveBeenCalled();
    expect(ctx.seen).toEqual([undefined]);
  });

  it('租戶停用或維護中：拋出 TENANT_UNAVAILABLE，不往下執行', async () => {
    const ctx = setup();
    ctx.tenancy.enter.mockRejectedValue(new AppException('TENANT_UNAVAILABLE'));
    await expect(ctx.use(`Bearer ${TOKEN}`)).rejects.toMatchObject({
      code: 'TENANT_UNAVAILABLE',
    });
    expect(ctx.next).not.toHaveBeenCalled();
  });
});
