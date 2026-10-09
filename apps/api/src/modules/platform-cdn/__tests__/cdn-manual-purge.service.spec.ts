import { describe, expect, it, vi } from 'vitest';

import type { AuthUser } from '@/common/types';
import { AppException } from '@/core/errors';
import type { JobQueue, JobRecord, JobStore } from '@/core/jobs';
import { CDN_PURGE_JOB } from '@/core/storage';
import type { CdnPathResolver } from '@/core/storage';
import { cdnConfigOf } from '@/core/storage/__tests__/cdn.fixture';
import type { PlatformPermissionKey } from '@/db/seeds/platform-permissions';
import type { PlatformAdminService } from '@/modules/platform-admin/platform-admin.service';
import type { PlatformAuditService } from '@/modules/platform-admin/platform-audit.service';

import { CdnManualPurgeService } from '../cdn-manual-purge.service';

const ACTOR: AuthUser = { id: 'admin-1', email: 'ops@example.com', status: 'active' };
const TENANT = '11111111-1111-4111-8111-111111111111';
const ASSET = '22222222-2222-4222-8222-222222222222';

function setup({
  env = {},
  permissions = ['cdn:purge'] as PlatformPermissionKey[],
  pending = [] as Partial<JobRecord>[],
} = {}) {
  let next = 0;
  const queue = { enqueue: vi.fn(async () => `job-${(next += 1)}`) };
  const jobs = { list: vi.fn(async () => ({ items: pending, total: pending.length })) };
  const resolver = {
    resolve: vi.fn(async () => ({
      paths: ['/storage/b2b-acme/images/a/master.webp', '/storage/b2b-acme/images/a/r1/sm.webp'],
    })),
    pathsOf: vi.fn(async (_tenant: string, keys: readonly string[]) => ({
      paths: keys.map((key) => `/storage/b2b-acme/${key}`),
    })),
  };
  const audit = {
    record: vi.fn(async () => undefined),
    recordSafely: vi.fn(async () => undefined),
  };
  const admins = { permissionsOf: vi.fn(async () => new Set(permissions)) };
  const service = new CdnManualPurgeService(
    cdnConfigOf(env),
    resolver as unknown as CdnPathResolver,
    queue as unknown as JobQueue,
    jobs as unknown as JobStore,
    admins as unknown as PlatformAdminService,
    audit as unknown as PlatformAuditService,
  );
  return { service, queue, resolver, audit };
}

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    return error instanceof AppException ? error.code : String(error);
  }
  return undefined;
}

describe('CdnManualPurgeService（docs/architecture/backend/09-file.md §16.11）', () => {
  it('依資源：CdnPathResolver 列出的路徑排入 cdn.purge（manual 帶誰、清什麼），寫稽核 cdn.purge', async () => {
    const { service, queue, resolver, audit } = setup();
    const result = await service.purge(
      { target: { type: 'imageAsset', tenantId: TENANT, id: ASSET } },
      ACTOR,
    );

    expect(resolver.resolve).toHaveBeenCalledWith(TENANT, 'imageAsset', ASSET);
    expect(queue.enqueue).toHaveBeenCalledWith(CDN_PURGE_JOB, {
      paths: ['/storage/b2b-acme/images/a/master.webp', '/storage/b2b-acme/images/a/r1/sm.webp'],
      manual: { requestedBy: 'admin-1', tenantId: TENANT, target: 'imageAsset', id: ASSET },
    });
    expect(result).toEqual({ jobIds: ['job-1'], paths: 2 });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'cdn.purge',
        resourceType: 'cdn',
        resourceId: TENANT,
        metadata: expect.objectContaining({ target: 'imageAsset', paths: 2, severity: 'normal' }),
      }),
    );
  });

  it('依路徑：依生效的批次大小分批', async () => {
    const { service, queue } = setup({ env: { FILE_CDN_PURGE_BATCH_SIZE: '2' } });
    const result = await service.purge(
      { target: { type: 'paths', tenantId: TENANT, paths: ['a', 'b', 'c'] } },
      ACTOR,
    );
    expect(queue.enqueue).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ jobIds: ['job-1', 'job-2'], paths: 3 });
  });

  it('整個快取：沒有 cdn:purgeAll → 403 AUTHZ_FORBIDDEN，寫 authz.denied，不入列', async () => {
    const { service, queue, audit } = setup();
    expect(await codeOf(service.purge({ target: { type: 'all' } }, ACTOR))).toBe('AUTHZ_FORBIDDEN');
    expect(queue.enqueue).not.toHaveBeenCalled();
    expect(audit.recordSafely).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'authz.denied',
        metadata: expect.objectContaining({ missing: ['cdn:purgeAll'] }),
      }),
    );
  });

  it('整個快取：有 cdn:purgeAll → 入列 { all: true }，稽核 severity high', async () => {
    const { service, queue, audit } = setup({ permissions: ['cdn:purge', 'cdn:purgeAll'] });
    expect(await service.purge({ target: { type: 'all' } }, ACTOR)).toEqual({
      jobIds: ['job-1'],
      paths: 'all',
    });
    expect(queue.enqueue).toHaveBeenCalledWith(CDN_PURGE_JOB, {
      all: true,
      manual: { requestedBy: 'admin-1', tenantId: null, target: 'all' },
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ all: true, severity: 'high' }),
      }),
    );
  });

  it('已經有一筆尚未完成的整個快取 → 409 CDN_PURGE_IN_PROGRESS', async () => {
    const { service, queue } = setup({
      permissions: ['cdn:purge', 'cdn:purgeAll'],
      pending: [{ id: 'job-0', data: { all: true } }],
    });
    expect(await codeOf(service.purge({ target: { type: 'all' } }, ACTOR))).toBe(
      'CDN_PURGE_IN_PROGRESS',
    );
    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  it('沒有部署 CDN → 409 CDN_NOT_DEPLOYED；沒有清理端點 → 409 CDN_NOT_READY', async () => {
    const target = { type: 'paths' as const, tenantId: TENANT, paths: ['a'] };
    expect(
      await codeOf(setup({ env: { FILE_CDN_ENABLED: 'false' } }).service.purge({ target }, ACTOR)),
    ).toBe('CDN_NOT_DEPLOYED');
    const noPurge = setup({
      env: { FILE_CDN_PURGE_ON_DELETE: 'false', FILE_CDN_PURGE_URL: '', FILE_CDN_PURGE_SECRET: '' },
    });
    expect(await codeOf(noPurge.service.purge({ target }, ACTOR))).toBe('CDN_NOT_READY');
  });
});
