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
  const use = (host: string, headers: Record<string, string> = {}) =>
    middleware.use(
      {
        headers: { host, ...headers },
        socket: { remoteAddress: '127.0.0.1' },
        app: { get: () => () => false },
        originalUrl: '/files',
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
    await ctx.use(PLATFORM_HOST, { 'x-tenant': 'acme' });
    expect(ctx.seen).toEqual([ACME_CONTEXT]);
    expect(ctx.seen[0]?.domain).toBeUndefined();
  });

  it('網域不屬於任何租戶：不進入租戶', async () => {
    const ctx = setup();
    await ctx.use('unknown.example.com');
    expect(ctx.seen).toEqual([undefined]);
  });
});
