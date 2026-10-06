import type { ConfigService } from '@nestjs/config';
import type { NextFunction, Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';

import type { Env } from '../../config';
import type { Tenancy } from '../tenancy.service';
import { currentTenant } from '../tenant-context';
import type { TenantContext } from '../tenant-context';
import type { TenantDirectory, TenantRecord } from '../tenant-directory.service';
import { TenantMiddleware } from '../tenant.middleware';

const ACME = { id: 't1', code: 'acme', status: 'active' } as unknown as TenantRecord;
const ACME_CONTEXT = { id: 't1', code: 'acme' } as unknown as TenantContext;
const PLATFORM_HOST = 'platform.example.com';

function setup() {
  const directory = {
    resolveHost: vi.fn(async (host: string) =>
      host === 'acme.example.com' || host === 'files.acme-corp.example' ? ACME : undefined,
    ),
    findByCode: vi.fn(async (code: string) => (code === 'acme' ? ACME : undefined)),
  };
  const tenancy = { enter: vi.fn(async (_tenant: TenantRecord) => ACME_CONTEXT) };
  const config = { get: () => `https://${PLATFORM_HOST}` } as unknown as ConfigService<Env, true>;
  const middleware = new TenantMiddleware(
    directory as unknown as TenantDirectory,
    tenancy as unknown as Tenancy,
    config,
  );
  /** next() 被呼叫時所在的租戶脈絡（undefined＝沒有進入任何租戶）。 */
  const seen: Array<TenantContext | undefined> = [];
  const next = vi.fn(() => {
    seen.push(currentTenant());
  });
  const use = (host: string, headers: Record<string, string> = {}, originalUrl = '/files') =>
    middleware.use(
      {
        headers: { host, ...headers },
        socket: { remoteAddress: '127.0.0.1' },
        app: { get: () => () => false },
        originalUrl,
        header: (name: string) => headers[name.toLowerCase()],
      } as unknown as Request,
      {} as Response,
      next as unknown as NextFunction,
    );
  return { use, seen };
}

describe('TenantMiddleware：記下比對到的網域（docs/architecture/backend/09-file.md §3）', () => {
  it('從次要網域（客戶自訂網域）進來：脈絡帶著那個網域，presigned 網址以它簽', async () => {
    const ctx = setup();
    await ctx.use('Files.Acme-Corp.example');
    expect(ctx.seen).toEqual([{ ...ACME_CONTEXT, domain: 'files.acme-corp.example' }]);
  });

  it('從主要網域進來：同樣記下（就是主要網域）', async () => {
    const ctx = setup();
    await ctx.use('acme.example.com');
    expect(ctx.seen[0]?.domain).toBe('acme.example.com');
  });

  it('apps/platform 的網域以 X-Tenant 指定租戶：那不是租戶的網域，不帶 domain（退回主要網域）', async () => {
    const ctx = setup();
    await ctx.use(PLATFORM_HOST, { 'x-tenant': 'acme' }, '/auth/forgot-password');
    expect(ctx.seen).toEqual([ACME_CONTEXT]);
    expect(ctx.seen[0]?.domain).toBeUndefined();
  });

  it('網域不屬於任何租戶：不進入租戶', async () => {
    const ctx = setup();
    await ctx.use('unknown.example.com');
    expect(ctx.seen).toEqual([undefined]);
  });
});

describe('TenantMiddleware：apps/platform 網域上的 X-Tenant 只給帳號流程（docs/architecture/05-tenancy.md §10.2 D26）', () => {
  it.each([
    '/auth/setup',
    '/auth/setup/verify?token=x',
    '/auth/register',
    '/auth/forgot-password',
    '/auth/reset-password',
    '/system/settings/public',
    '/Auth/Forgot-Password',
  ])('%s：以標頭進入租戶', async (url) => {
    const ctx = setup();
    await ctx.use(PLATFORM_HOST, { 'x-tenant': 'acme' }, url);
    expect(ctx.seen).toEqual([ACME_CONTEXT]);
  });

  it.each(['/users', '/auth/login', '/auth/refresh', '/auth/sso/callback', '/files'])(
    '%s：不採用標頭，沒有租戶（租戶的 token 不能經由平台網域使用）',
    async (url) => {
      const ctx = setup();
      await ctx.use(PLATFORM_HOST, { 'x-tenant': 'acme' }, url);
      expect(ctx.seen).toEqual([undefined]);
    },
  );
});

describe('TenantMiddleware：平台端點只在 apps/platform 的網域（docs/architecture/05-tenancy.md §2）', () => {
  it.each([
    '/platform/tenants',
    '/PLATFORM/tenants',
    '/Platform/auth/profile',
    '/oidc-interaction/x',
  ])('其他網域的 %s → PLATFORM_ONLY（比對不分大小寫，與 Express 的路由一致）', async (url) => {
    const ctx = setup();
    await expect(ctx.use('unknown.example.com', {}, url)).rejects.toMatchObject({
      code: 'PLATFORM_ONLY',
    });
    await expect(ctx.use('acme.example.com', {}, url)).rejects.toMatchObject({
      code: 'PLATFORM_ONLY',
    });
  });
});
