import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { BroadcastHub, flushBroadcast } from '../../broadcast/__tests__/broadcast-hub';
import type { Env } from '../../config/env.schema';
import type { Database, DbOrTx } from '../../database';
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

function setup(
  rows: Array<{ key: string; value: unknown }> = [],
  hub: BroadcastHub = new BroadcastHub(),
) {
  const repo = {
    listAll: vi.fn(async () =>
      rows.map((row) => ({ ...row, updatedAt: new Date('2026-09-30T00:00:00Z'), updatedBy: null })),
    ),
    upsert: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
  };
  const config = {
    get: vi.fn((key: keyof Env) => ({ FILE_UPLOAD_MAX_SIZE: 1000 })[key as string]),
  };
  const broadcast = hub.instance();
  const service = new SettingService(
    repo as unknown as SettingRepository,
    config as unknown as ConfigService<Env, true>,
    broadcast,
  );
  return { service, repo, broadcast };
}

function tenant(id: string): TenantContext {
  return {
    id,
    code: id,
    db: {} as Database,
    storageBucket: `b2b-${id}`,
    features: ['file', 'auditLog', 'job'],
    flags: {},
    featureParams: {},
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

  it('查詢期間被 invalidate()：回來的舊值不寫回快取，下一次重新查 DB', async () => {
    const { service, repo } = setup();
    service.register([MAX_ATTEMPTS]);
    let resolveStale: ((rows: unknown[]) => void) | undefined;
    repo.listAll.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveStale = resolve as (rows: unknown[]) => void;
        }) as never,
    );
    const loading = service.get(MAX_ATTEMPTS);
    // 寫入的交易提交 → invalidate()；之後才回來的是寫入前的值
    service.invalidate();
    resolveStale?.([
      { key: 'auth.loginMaxAttempts', value: 8, updatedAt: new Date(), updatedBy: null },
    ]);
    await expect(loading).resolves.toBe(8);

    repo.listAll.mockResolvedValueOnce([
      { key: 'auth.loginMaxAttempts', value: 12, updatedAt: new Date(), updatedBy: null },
    ] as never);
    await expect(service.get(MAX_ATTEMPTS)).resolves.toBe(12);
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

  it('一個程序 invalidate，其他程序同一個租戶的快取也作廢（docs/architecture/06-external-api.md §9.2 D16）', async () => {
    const hub = new BroadcastHub();
    const [a, b] = [setup([], hub), setup([], hub)];
    for (const { service, broadcast } of [a, b]) {
      service.register([MAX_ATTEMPTS]);
      service.onModuleInit();
      // oxlint-disable-next-line no-await-in-loop -- 依序啟動兩個程序
      await broadcast.onApplicationBootstrap();
    }
    await runInTenantContext(tenant('t1'), () => b.service.get(MAX_ATTEMPTS));
    await runInTenantContext(tenant('t2'), () => b.service.get(MAX_ATTEMPTS));

    await runInTenantContext(tenant('t1'), async () => a.service.invalidate());
    await flushBroadcast();

    await runInTenantContext(tenant('t1'), () => b.service.get(MAX_ATTEMPTS));
    await runInTenantContext(tenant('t2'), () => b.service.get(MAX_ATTEMPTS));
    // t1 重新查一次；t2 仍命中
    expect(b.repo.listAll).toHaveBeenCalledTimes(3);
  });
});

describe('SettingService：登記、寫入與快取（docs/architecture/backend/12-settings.md）', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('list() 依登記順序回傳所有設定（env 相依的部分已算好）', () => {
    const { service } = setup();
    service.register([UPLOAD_MAX, MAX_ATTEMPTS]);
    expect(service.list().map(({ key, defaultValue }) => ({ key, defaultValue }))).toEqual([
      { key: 'file.uploadMaxSize', defaultValue: 1000 },
      { key: 'auth.loginMaxAttempts', defaultValue: 5 },
    ]);
  });

  it('find() 以 key 找到登記的設定；沒登記的回 undefined', () => {
    const { service } = setup();
    service.register([MAX_ATTEMPTS]);
    expect(service.find('auth.loginMaxAttempts')?.defaultValue).toBe(5);
    expect(service.find('auth.unknown')).toBeUndefined();
  });

  it('一批登記中途有重複的 key：前面的仍已登記', () => {
    const { service } = setup();
    expect(() => service.register([MAX_ATTEMPTS, UPLOAD_MAX, MAX_ATTEMPTS])).toThrow(/重複登記/);
    expect(service.list().map(({ key }) => key)).toEqual([
      'auth.loginMaxAttempts',
      'file.uploadMaxSize',
    ]);
  });

  it('save() 寫入覆寫值並帶上操作者與交易', async () => {
    const { service, repo } = setup();
    const tx = {} as DbOrTx;
    await service.save('auth.loginMaxAttempts', 8, 'u1', tx);
    expect(repo.upsert).toHaveBeenCalledWith('auth.loginMaxAttempts', 8, 'u1', tx);
  });

  it('reset() 刪掉覆寫值（還原預設）並帶上交易', async () => {
    const { service, repo } = setup();
    const tx = {} as DbOrTx;
    await service.reset('auth.loginMaxAttempts', tx);
    expect(repo.remove).toHaveBeenCalledWith('auth.loginMaxAttempts', tx);
  });

  it('save() 不會自己失效快取：要等呼叫端在交易提交後 invalidate()', async () => {
    const { service, repo } = setup();
    service.register([MAX_ATTEMPTS]);
    await service.get(MAX_ATTEMPTS);
    await service.save('auth.loginMaxAttempts', 8, 'u1');
    await service.get(MAX_ATTEMPTS);
    expect(repo.listAll).toHaveBeenCalledTimes(1);
  });

  it('TTL（30 秒）到期後重新查資料庫', async () => {
    vi.useFakeTimers({ now: new Date('2026-10-01T00:00:00Z') });
    const { service, repo } = setup();
    service.register([MAX_ATTEMPTS]);
    await service.get(MAX_ATTEMPTS);

    vi.advanceTimersByTime(29_999);
    await service.get(MAX_ATTEMPTS);
    expect(repo.listAll).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1);
    await service.get(MAX_ATTEMPTS);
    expect(repo.listAll).toHaveBeenCalledTimes(2);
  });

  it('stored() 回傳覆寫值與最後修改時間', async () => {
    const { service } = setup([{ key: 'auth.loginMaxAttempts', value: 8 }]);
    expect(await service.stored()).toEqual(
      new Map([
        ['auth.loginMaxAttempts', { value: 8, updatedAt: new Date('2026-09-30T00:00:00Z') }],
      ]),
    );
  });

  it('存的值不合 schema 時記 warn（含 key 與租戶）', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    const { service } = setup([{ key: 'auth.loginMaxAttempts', value: 'x' }]);
    service.register([MAX_ATTEMPTS]);
    await runInTenantContext(tenant('t1'), () => service.get(MAX_ATTEMPTS));
    expect(warn).toHaveBeenCalledWith(
      { key: 'auth.loginMaxAttempts', tenantId: 't1' },
      expect.any(String),
    );
  });

  it('存的值經 schema 轉換後才回傳', async () => {
    const trimmed = defineSetting({
      key: 'general.name',
      category: SettingCategory.GENERAL,
      schema: z.string().trim(),
      defaultValue: 'Acme',
      isPublic: true,
    });
    const { service } = setup([{ key: 'general.name', value: '  Beta ' }]);
    service.register([trimmed]);
    await expect(service.get(trimmed)).resolves.toBe('Beta');
  });

  it('其他程序的監聽連線重連 → 該程序所有租戶的快取都丟掉', async () => {
    const hub = new BroadcastHub();
    const b = setup([], hub);
    b.service.register([MAX_ATTEMPTS]);
    b.service.onModuleInit();
    await b.broadcast.onApplicationBootstrap();
    await runInTenantContext(tenant('t1'), () => b.service.get(MAX_ATTEMPTS));
    await runInTenantContext(tenant('t2'), () => b.service.get(MAX_ATTEMPTS));

    hub.reconnect();
    await flushBroadcast();

    await runInTenantContext(tenant('t1'), () => b.service.get(MAX_ATTEMPTS));
    await runInTenantContext(tenant('t2'), () => b.service.get(MAX_ATTEMPTS));
    expect(b.repo.listAll).toHaveBeenCalledTimes(4);
  });

  it('invalidate() 廣播目前租戶的 id；本程序不會因為自己的廣播再失效一次', async () => {
    const hub = new BroadcastHub();
    const a = setup([], hub);
    a.service.register([MAX_ATTEMPTS]);
    a.service.onModuleInit();
    await a.broadcast.onApplicationBootstrap();

    // 失效後、廣播分派前就重新載入；之後收到自己送出的訊息也不該把它丟掉
    await runInTenantContext(tenant('t1'), async () => {
      a.service.invalidate();
      await a.service.get(MAX_ATTEMPTS);
    });
    await flushBroadcast();
    expect(hub.messages('settings')).toEqual([{ tenant: 't1' }]);

    await runInTenantContext(tenant('t1'), () => a.service.get(MAX_ATTEMPTS));
    expect(a.repo.listAll).toHaveBeenCalledTimes(1);
  });

  it('還沒 onModuleInit（沒有廣播頻道）時 invalidate() 仍清掉本機快取', async () => {
    const { service, repo } = setup();
    service.register([MAX_ATTEMPTS]);
    await service.get(MAX_ATTEMPTS);
    expect(() => service.invalidate()).not.toThrow();
    await service.get(MAX_ATTEMPTS);
    expect(repo.listAll).toHaveBeenCalledTimes(2);
  });
});
