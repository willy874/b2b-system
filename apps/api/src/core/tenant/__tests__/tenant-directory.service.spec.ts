import { randomBytes } from 'node:crypto';

import type { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';

import type { TenantRow } from '@/db/platform/schema';

import type { Env } from '../../config';
import { SecretBox, TENANT_SECRET_PURPOSE } from '../../crypto';
import { BoundedCache } from '../bounded-cache';
import { TENANT_CACHE_MAX_ENTRIES, TenantDirectory } from '../tenant-directory.service';
import type { TenantRepository } from '../tenant.repository';

const SECRET_KEY = randomBytes(32).toString('base64');
const box = SecretBox.fromConfig(SECRET_KEY, '', TENANT_SECRET_PURPOSE);

function tenantRow(id: string, code: string): TenantRow {
  return {
    id,
    code,
    name: code,
    status: 'active',
    databaseUrlEncrypted: box.encrypt(`postgres://u:p@127.0.0.1:5432/${code}`),
    storageBucket: `b2b-${code}`,
    allowExternalIdp: true,
    features: ['file', 'auditLog', 'job'],
    flags: {},
  } as TenantRow;
}

function setup() {
  const acme = tenantRow('tenant-acme', 'acme');
  const domains = [{ domain: 'acme.example.com', tenantId: acme.id }];
  const repo = {
    listDomains: vi.fn(async () => [...domains]),
    findByDomains: vi.fn(async (candidates: string[]) =>
      domains
        .filter((row) => candidates.includes(row.domain))
        .map((row) => ({ domain: row.domain, tenant: acme })),
    ),
    findByCode: vi.fn(async (code: string) => (code === acme.code ? acme : undefined)),
    findById: vi.fn(async () => undefined),
  };
  const config = {
    get: (key: string) =>
      ({ TENANT_SECRET_KEY: SECRET_KEY, JWT_SECRET: 'x', TENANT_CACHE_TTL: 30 })[key],
  } as unknown as ConfigService<Env, true>;
  const directory = new TenantDirectory(repo as unknown as TenantRepository, config);
  return { directory, repo, domains, acme };
}

function sizeOf(directory: TenantDirectory, cache: 'byHost' | 'byCode'): number {
  const caches = directory as unknown as Record<typeof cache, BoundedCache<string, unknown>>;
  return caches[cache].size;
}

describe('TenantDirectory', () => {
  it('不在網域快照裡的 Host 直接視為找不到：不查平台 DB、不佔快取', async () => {
    const { directory, repo } = setup();
    await directory.onApplicationBootstrap();

    for (let i = 0; i < 20_000; i += 1) {
      // oxlint-disable-next-line no-await-in-loop -- 依序送出，模擬大量不同的 Host
      expect(await directory.resolveHost(`random-${i}.attacker.test`)).toBeUndefined();
    }
    expect(repo.findByDomains).not.toHaveBeenCalled();
    expect(sizeOf(directory, 'byHost')).toBe(0);
    directory.onModuleDestroy();
  });

  it('登記過的網域查一次 DB 之後走快取', async () => {
    const { directory, repo } = setup();
    await directory.onApplicationBootstrap();

    expect((await directory.resolveHost('acme.example.com'))?.code).toBe('acme');
    expect((await directory.resolveHost('ACME.example.com'))?.code).toBe('acme');
    expect(repo.findByDomains).toHaveBeenCalledTimes(1);
    directory.onModuleDestroy();
  });

  it('invalidate() 之後剛登記的網域立刻找得到（等快照重新載入完才判斷）', async () => {
    const { directory, domains, acme } = setup();
    await directory.onApplicationBootstrap();
    expect(await directory.resolveHost('new.example.com')).toBeUndefined();

    domains.push({ domain: 'new.example.com', tenantId: acme.id });
    directory.invalidate();
    expect((await directory.resolveHost('new.example.com'))?.id).toBe(acme.id);
    directory.onModuleDestroy();
  });

  it('快照還沒載入（啟動時 DB 暫時連不上）時退回查 DB', async () => {
    const { directory, repo } = setup();
    expect((await directory.resolveHost('acme.example.com'))?.code).toBe('acme');
    expect(repo.findByDomains).toHaveBeenCalledTimes(1);
  });

  it('租戶代碼：格式不對的不查 DB；快取有上限', async () => {
    const { directory, repo } = setup();
    expect(await directory.findByCode('../../etc')).toBeUndefined();
    expect(await directory.findByCode('x'.repeat(200))).toBeUndefined();
    expect(repo.findByCode).not.toHaveBeenCalled();

    for (let i = 0; i < TENANT_CACHE_MAX_ENTRIES + 500; i += 1) {
      // oxlint-disable-next-line no-await-in-loop -- 依序送出
      await directory.findByCode(`code-${i}`);
    }
    expect(sizeOf(directory, 'byCode')).toBe(TENANT_CACHE_MAX_ENTRIES);
    expect((await directory.findByCode('ACME'))?.id).toBe('tenant-acme');
  });
});

describe('BoundedCache', () => {
  it('超過上限時淘汰最久沒用到的項目', () => {
    const cache = new BoundedCache<string, number>(2);
    cache.set('a', 1, 1000);
    cache.set('b', 2, 1000);
    expect(cache.get('a')).toEqual({ value: 1 });
    cache.set('c', 3, 1000);
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toEqual({ value: 1 });
    expect(cache.get('c')).toEqual({ value: 3 });
  });

  it('過期的項目讀到時刪除；快取的 undefined 與「沒有」分得開', () => {
    let now = 0;
    const cache = new BoundedCache<string, number | undefined>(10, () => now);
    cache.set('missing', undefined, 100);
    expect(cache.get('missing')).toEqual({ value: undefined });
    now = 100;
    expect(cache.get('missing')).toBeUndefined();
    expect(cache.size).toBe(0);
  });
});
