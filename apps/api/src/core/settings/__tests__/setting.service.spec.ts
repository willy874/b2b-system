import type { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import type { Env } from '../../config/env.schema';
import type { Database } from '../../database';
import { runInTenantContext } from '../../tenant';
import type { TenantContext } from '../../tenant';
import { defineSetting, SettingCategory } from '../setting-definition';
import type { SettingRepository } from '../setting.repository';
import { SettingService } from '../setting.service';

const MAX_ATTEMPTS = defineSetting({
  key: 'auth.loginMaxAttempts',
  category: SettingCategory.AUTH,
  schema: z.number().int().min(3).max(20),
  defaultValue: 5,
  isPublic: false,
});

const UPLOAD_MAX = defineSetting({
  key: 'file.uploadMaxSize',
  category: SettingCategory.FILE,
  schema: (env) => z.number().int().max(env('FILE_UPLOAD_MAX_SIZE')),
  defaultValue: (env) => env('FILE_UPLOAD_MAX_SIZE'),
  isPublic: false,
});

function setup(rows: Array<{ key: string; value: unknown }> = []) {
  const repo = {
    listAll: vi.fn(async () =>
      rows.map((row) => ({ ...row, updatedAt: new Date('2026-09-30T00:00:00Z'), updatedBy: null })),
    ),
  };
  const config = {
    get: vi.fn((key: keyof Env) => ({ FILE_UPLOAD_MAX_SIZE: 1000 })[key as string]),
  };
  const service = new SettingService(
    repo as unknown as SettingRepository,
    config as unknown as ConfigService<Env, true>,
  );
  return { service, repo };
}

function tenant(id: string): TenantContext {
  return {
    id,
    code: id,
    db: {} as Database,
    storageBucket: `b2b-${id}`,
    allowExternalIdp: false,
    features: ['file', 'auditLog', 'job'],
  };
}

describe('SettingService（docs/architecture/backend/12-settings.md §1）', () => {
  it('沒有覆寫時回傳預設值；env 相依的預設值與範圍取自 env', async () => {
    const { service } = setup();
    service.register([MAX_ATTEMPTS, UPLOAD_MAX]);
    await expect(service.get(MAX_ATTEMPTS)).resolves.toBe(5);
    await expect(service.get(UPLOAD_MAX)).resolves.toBe(1000);
  });

  it('有覆寫值時回傳覆寫值', async () => {
    const { service } = setup([{ key: 'auth.loginMaxAttempts', value: 8 }]);
    service.register([MAX_ATTEMPTS]);
    await expect(service.get(MAX_ATTEMPTS)).resolves.toBe(8);
  });

  it('存的值不合目前的 schema（之後收緊了範圍）→ 退回預設值', async () => {
    const { service } = setup([{ key: 'auth.loginMaxAttempts', value: 0 }]);
    service.register([MAX_ATTEMPTS]);
    await expect(service.get(MAX_ATTEMPTS)).resolves.toBe(5);
  });

  it('同一個 key 重複登記 → 啟動失敗', () => {
    const { service } = setup();
    service.register([MAX_ATTEMPTS]);
    expect(() => service.register([MAX_ATTEMPTS])).toThrow(/重複登記/);
  });

  it('預設值不符合自己的 schema（例：env 上限比預設值小）→ 啟動失敗', () => {
    const { service } = setup();
    const broken = defineSetting({ ...MAX_ATTEMPTS, key: 'auth.broken', defaultValue: 1 });
    expect(() => service.register([broken])).toThrow(/auth\.broken/);
  });

  it('讀取沒有登記的設定 → 拋錯（程式錯誤，不是使用者的錯）', async () => {
    const { service } = setup();
    await expect(service.get(MAX_ATTEMPTS)).rejects.toThrow(/沒有登記/);
  });

  it('同一個租戶在 TTL 內只查一次資料庫；invalidate 後重新查', async () => {
    const { service, repo } = setup();
    service.register([MAX_ATTEMPTS]);
    await service.get(MAX_ATTEMPTS);
    await service.get(MAX_ATTEMPTS);
    expect(repo.listAll).toHaveBeenCalledTimes(1);

    service.invalidate();
    await service.get(MAX_ATTEMPTS);
    expect(repo.listAll).toHaveBeenCalledTimes(2);
  });

  it('快取以租戶區分：A 租戶的快取不會被 B 租戶拿去用', async () => {
    const { service, repo } = setup();
    service.register([MAX_ATTEMPTS]);
    await runInTenantContext(tenant('a'), () => service.get(MAX_ATTEMPTS));
    await runInTenantContext(tenant('b'), () => service.get(MAX_ATTEMPTS));
    expect(repo.listAll).toHaveBeenCalledTimes(2);

    // 只失效 B：A 仍命中快取
    await runInTenantContext(tenant('b'), async () => service.invalidate());
    await runInTenantContext(tenant('a'), () => service.get(MAX_ATTEMPTS));
    expect(repo.listAll).toHaveBeenCalledTimes(2);
  });
});
