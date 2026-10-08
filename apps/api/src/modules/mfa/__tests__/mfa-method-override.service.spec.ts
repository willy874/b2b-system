import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runInTenantContext } from '@/core/tenant';
import type { TenantContext } from '@/core/tenant';

import {
  MFA_METHOD_OVERRIDE_CHANNEL,
  MfaMethodOverrideService,
} from '../mfa-method-override.service';
import { method, TENANT_ID } from './mfa.fixture';

interface ChannelOptions {
  parse: (value: unknown) => unknown;
  onMessage: () => unknown;
  onReconnect: () => unknown;
}

function setup(ttlSeconds = 30) {
  const repo = {
    listGlobal: vi.fn(async () => [
      { method: 'totp', state: 'off' },
      { method: 'email', state: 'on' },
      { method: 'legacy', state: 'garbage' },
    ]),
  };
  const publish = vi.fn(async () => undefined);
  const broadcast = { channel: vi.fn((_name: string, _options: ChannelOptions) => publish) };
  const config = { get: vi.fn(() => ttlSeconds) };
  const service = new MfaMethodOverrideService(repo as never, broadcast as never, config as never);
  const channelOptions = () => broadcast.channel.mock.calls[0]![1];
  return { service, repo, broadcast, publish, channelOptions };
}

function tenantWith(mfaMethods?: Record<string, boolean>): TenantContext {
  return {
    id: TENANT_ID,
    code: 'acme',
    db: {} as never,
    storageBucket: 'bucket',
    features: [],
    flags: {},
    featureParams: {},
    mfaMethods,
  };
}

describe('MfaMethodOverrideService（docs/architecture/backend/21-mfa.md §5、D4）', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('onModuleInit 訂閱廣播頻道；收到訊息或重新連線時重讀', async () => {
    const { service, broadcast, repo, channelOptions } = setup();
    service.onModuleInit();
    expect(broadcast.channel).toHaveBeenCalledWith(MFA_METHOD_OVERRIDE_CHANNEL, expect.any(Object));
    const options = channelOptions();
    expect(options.parse({})).toEqual({});
    expect(options.parse(null)).toBeNull();
    expect(options.parse('x')).toBeNull();
    await options.onMessage();
    await options.onReconnect();
    expect(repo.listGlobal).toHaveBeenCalledTimes(2);
  });

  it('啟動時載入全平台層，只保留合法的狀態', async () => {
    const { service } = setup();
    await service.onApplicationBootstrap();
    expect(service.globalStateOf('totp')).toBe('off');
    expect(service.globalStateOf('email')).toBe('on');
    expect(service.globalStateOf('legacy')).toBeUndefined();
    service.onModuleDestroy();
  });

  it('TTL > 0 時定期重讀；onModuleDestroy 後停止', async () => {
    const { service, repo } = setup(10);
    await service.onApplicationBootstrap();
    expect(repo.listGlobal).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(repo.listGlobal).toHaveBeenCalledTimes(2);
    service.onModuleDestroy();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(repo.listGlobal).toHaveBeenCalledTimes(2);
  });

  it('TTL = 0 時只在啟動時讀一次', async () => {
    const { service, repo } = setup(0);
    await service.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(repo.listGlobal).toHaveBeenCalledTimes(1);
  });

  it('讀取失敗時記錄錯誤並沿用上一份', async () => {
    const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const { service, repo } = setup(0);
    await service.reload();
    repo.listGlobal.mockRejectedValueOnce(new Error('db down'));
    await service.reload();
    expect(service.globalStateOf('totp')).toBe('off');
    expect(error).toHaveBeenCalledTimes(1);
  });

  it('changed：本機立即重讀，再通知其他程序', async () => {
    const { service, repo, publish } = setup(0);
    service.onModuleInit();
    await service.changed();
    expect(repo.listGlobal).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith({});
  });

  it('changed：還沒訂閱頻道時只重讀', async () => {
    const { service, repo, publish } = setup(0);
    await service.changed();
    expect(repo.listGlobal).toHaveBeenCalledTimes(1);
    expect(publish).not.toHaveBeenCalled();
  });

  describe('isEnabled（與 feature flag 同一個規則 resolveToggle）', () => {
    it('沒有任何覆寫時用方式的預設值', () => {
      const { service } = setup(0);
      expect(service.isEnabled(method('totp'))).toBe(true);
      expect(service.isEnabled(method('totp', { defaultEnabled: false }))).toBe(false);
    });

    it('全平台 off 蓋過租戶的 on', async () => {
      const { service } = setup(0);
      await service.reload();
      expect(service.isEnabled(method('totp'), { totp: true })).toBe(false);
    });

    it('租戶層的覆寫蓋過全平台 on；預設從目前的租戶脈絡讀取', async () => {
      const { service } = setup(0);
      await service.reload();
      const email = method('email', { defaultEnabled: false });
      expect(service.isEnabled(email)).toBe(true);
      expect(runInTenantContext(tenantWith({ email: false }), () => service.isEnabled(email))).toBe(
        false,
      );
      expect(runInTenantContext(tenantWith(), () => service.isEnabled(email))).toBe(true);
    });
  });
});
