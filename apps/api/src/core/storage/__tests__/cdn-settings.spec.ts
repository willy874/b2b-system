import type { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';

import type { CdnSettingsRow } from '@/db/platform/schema';

import type { BroadcastChannelSubscriber, BroadcastService } from '../../broadcast';
import type { Env } from '../../config';
import { runInTenantContext } from '../../tenant';
import type { TenantContext } from '../../tenant';
import { CDN_SETTINGS_CHANNEL, CdnSettings, resolveCdnEffective } from '../cdn-settings';
import type {
  CdnDeploymentLimits,
  CdnSettingsRepository,
  CdnStoredOverrides,
} from '../cdn-settings';
import { NginxCdnUrlSigner } from '../cdn-url-signer';
import type { PresignedUrlSigner } from '../object-url-signer';
import { cdnConfigOf } from './cdn.fixture';
import type { FakeCdnOverrides } from './cdn.fixture';

const LIMITS: CdnDeploymentLimits = {
  resources: new Set(['imageAsset', 'galleryItem', 'fileVariant'] as const),
  maxUrlTtl: 86_400,
  purgeOnDelete: true,
  purgeBatchSize: 100,
};

const NONE: CdnStoredOverrides = {
  state: null,
  resources: null,
  urlTtlCap: null,
  purgeOnDelete: null,
  purgeBatchSize: null,
};

describe('resolveCdnEffective：生效值的解析（docs/architecture/backend/09-file.md §16.9）', () => {
  it('沒有列 → 與只有環境變數時相同：開著、資源與參數都用環境變數', () => {
    expect(resolveCdnEffective(LIMITS, undefined)).toEqual({
      serving: true,
      resources: ['fileVariant', 'imageAsset', 'galleryItem'],
      urlTtlCap: 86_400,
      purgeOnDelete: true,
      purgeBatchSize: 100,
      clamped: { resources: [], urlTtlCap: false },
    });
  });

  it('每個欄位都是 null 的列 → 與沒有列相同', () => {
    expect(resolveCdnEffective(LIMITS, NONE)).toEqual(resolveCdnEffective(LIMITS, undefined));
  });

  it('各欄位的覆寫：state off、只開一種資源、調低效期、關掉自動清理、調整批次', () => {
    const effective = resolveCdnEffective(LIMITS, {
      state: 'off',
      resources: ['fileVariant'],
      urlTtlCap: 3600,
      purgeOnDelete: false,
      purgeBatchSize: 10,
    });
    expect(effective).toMatchObject({
      serving: false,
      resources: ['fileVariant'],
      urlTtlCap: 3600,
      purgeOnDelete: false,
      purgeBatchSize: 10,
    });
  });

  it('空的資源清單 → 沒有資源走 CDN（不是回到環境變數）', () => {
    expect(resolveCdnEffective(LIMITS, { ...NONE, resources: [] }).resources).toEqual([]);
  });

  it('超過部署的上限 → 讀取時裁切並標示：資源取交集、效期取較小者', () => {
    const limits = { ...LIMITS, resources: new Set(['fileVariant'] as const), maxUrlTtl: 3600 };
    const effective = resolveCdnEffective(limits, {
      ...NONE,
      resources: ['fileVariant', 'imageAsset'],
      urlTtlCap: 86_400,
    });
    expect(effective.resources).toEqual(['fileVariant']);
    expect(effective.urlTtlCap).toBe(3600);
    expect(effective.clamped).toEqual({ resources: ['imageAsset'], urlTtlCap: true });
  });

  it('DB 裡不認得的資源類型（程式移除了某種資源）→ 忽略，也不算裁切', () => {
    const effective = resolveCdnEffective(LIMITS, { ...NONE, resources: ['fileVariant', 'video'] });
    expect(effective.resources).toEqual(['fileVariant']);
    expect(effective.clamped.resources).toEqual([]);
  });

  it('執行期關閉不影響清理（§17 D13）', () => {
    expect(resolveCdnEffective(LIMITS, { ...NONE, state: 'off' }).purgeOnDelete).toBe(true);
  });
});

describe('CdnConfig 讀執行期的覆寫（不必重啟）', () => {
  it('覆寫改變後，下一次呼叫就用新的生效值', () => {
    const stored: FakeCdnOverrides = { current: undefined };
    const config = cdnConfigOf({ FILE_CDN_MAX_URL_TTL: '7200' }, stored);
    expect(config.servesResource('imageAsset')).toBe(true);
    expect(config.maxUrlTtl()).toBe(7200);

    stored.current = { ...NONE, state: 'off', urlTtlCap: 600, purgeBatchSize: 5 };
    expect(config.servesResource('imageAsset')).toBe(false);
    expect(config.maxUrlTtl()).toBe(600);
    expect(config.purgeBatchSize()).toBe(5);
    // 關閉時清理照常（§17 D13）
    expect(config.purgeOnDelete()).toBe(true);

    stored.current = { ...NONE, resources: ['fileVariant'] };
    expect(config.servesResource('imageAsset')).toBe(false);
    expect(config.servesResource('fileVariant')).toBe(true);
  });

  it('FILE_CDN_ENABLED=false → 執行期的設定被忽略：不走 CDN、不清理', () => {
    const config = cdnConfigOf(
      { FILE_CDN_ENABLED: 'false' },
      { current: { ...NONE, state: 'on', purgeOnDelete: true } },
    );
    expect(config.servesResource('imageAsset')).toBe(false);
    expect(config.purgeOnDelete()).toBe(false);
    expect(config.effective()).toBeUndefined();
  });

  it('執行期關閉 → CdnUrlSigner 改簽 presigned', async () => {
    const stored: FakeCdnOverrides = { current: undefined };
    const config = cdnConfigOf({}, stored);
    const presigned = {
      sign: vi.fn(async () => ({ url: 'http://storage/presigned', expiresAt: new Date() })),
    };
    const signer = new NginxCdnUrlSigner(presigned as unknown as PresignedUrlSigner, config);
    const sign = () =>
      runInTenantContext({ id: 't1', storageBucket: 'b2b-acme' } as TenantContext, () =>
        signer.sign('images/a/master.webp', { expiresIn: 3600, cdn: 'imageAsset' }),
      );

    expect((await sign()).url).toMatch(/^https:\/\/cdn\.example\.test\/storage\/b2b-acme\//);
    stored.current = { ...NONE, state: 'off' };
    expect((await sign()).url).toBe('http://storage/presigned');
  });
});

function settingsService(rows: Array<CdnSettingsRow | undefined>, enabled = true) {
  const repo = { find: vi.fn(async () => rows.shift()) };
  const subscribers = new Map<string, BroadcastChannelSubscriber<unknown>>();
  const publish = vi.fn(async () => undefined);
  const broadcast = {
    channel: vi.fn((name: string, sub: BroadcastChannelSubscriber<unknown>) => {
      subscribers.set(name, sub);
      return publish;
    }),
  };
  const config = {
    get: (key: keyof Env) => ({ FILE_CDN_ENABLED: enabled, TENANT_CACHE_TTL: 0 })[key as string],
  } as unknown as ConfigService<Env, true>;
  const service = new CdnSettings(
    repo as unknown as CdnSettingsRepository,
    broadcast as unknown as BroadcastService,
    config,
  );
  return { service, repo, publish, subscribers };
}

const ROW = { id: 'default', state: 'off', version: 2 } as CdnSettingsRow;

describe('CdnSettings：快取與跨程序同步（docs/architecture/01-system.md §4.4）', () => {
  it('啟動時載入；changed() 本機重讀後送出 cdn_settings', async () => {
    const { service, publish } = settingsService([undefined, ROW]);
    service.onModuleInit();
    await service.onApplicationBootstrap();
    expect(service.current()).toBeUndefined();

    await service.changed();
    expect(service.current()).toBe(ROW);
    expect(publish).toHaveBeenCalledWith({});
  });

  it('收到其他程序的廣播 → 重新讀取；重新連線也重新讀取', async () => {
    const { service, subscribers } = settingsService([undefined, ROW, undefined]);
    service.onModuleInit();
    await service.onApplicationBootstrap();
    const subscriber = subscribers.get(CDN_SETTINGS_CHANNEL);
    await subscriber?.onMessage(subscriber.parse({}));
    expect(service.current()).toBe(ROW);
    await subscriber?.onReconnect?.();
    expect(service.current()).toBeUndefined();
  });

  it('讀取失敗 → 沿用上一份', async () => {
    const { service, repo } = settingsService([ROW]);
    await service.onApplicationBootstrap();
    repo.find.mockRejectedValueOnce(new Error('platform db down'));
    await service.reload();
    expect(service.current()).toBe(ROW);
  });

  it('沒有部署 CDN → 不訂閱、不載入', async () => {
    const { service, repo, subscribers } = settingsService([ROW], false);
    service.onModuleInit();
    await service.onApplicationBootstrap();
    expect(subscribers.size).toBe(0);
    expect(repo.find).not.toHaveBeenCalled();
  });
});
