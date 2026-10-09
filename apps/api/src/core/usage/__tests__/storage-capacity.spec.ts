import type { ConfigService } from '@nestjs/config';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Env } from '../../config';
import { AppException } from '../../errors';
import { STORAGE_TOTAL_STALE_AFTER_MS, StorageCapacity } from '../storage-capacity';
import type { StorageTotalRepository } from '../storage-total.repository';

const MIB = 1024 * 1024;
const NOW = new Date('2026-10-09T12:00:00.000Z');

function setup(limitMb: number, usedBytes: number, measuredAt: Date | null = NOW) {
  const repo = { total: vi.fn(async () => ({ usedBytes, measuredAt })) };
  const config = { get: vi.fn(() => limitMb) } as unknown as ConfigService<Env, true>;
  const capacity = new StorageCapacity(repo as unknown as StorageTotalRepository, config);
  return { capacity, repo };
}

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  return error instanceof AppException ? error.code : undefined;
}

describe('StorageCapacity（儲存的止水線，docs/architecture/backend/25-image.md §12 D8）', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('不啟用（0）時不查 DB、一律放行', async () => {
    const { capacity, repo } = setup(0, 10 ** 15);
    await expect(capacity.assertCanStore(MIB)).resolves.toBeUndefined();
    expect(repo.total).not.toHaveBeenCalled();
  });

  it('加上這次的大小剛好到上限可以，超過就拋 STORAGE_TOTAL_LIMIT_REACHED（不帶平台的數字）', async () => {
    const { capacity } = setup(100, 99 * MIB);
    await expect(capacity.assertCanStore(MIB)).resolves.toBeUndefined();

    const error = await capacity.assertCanStore(MIB + 1).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AppException);
    expect(error).toMatchObject({ code: 'STORAGE_TOTAL_LIMIT_REACHED', details: undefined });
  });

  it('還沒有任何量測、量測超過 1 小時：放行（背景工作故障不能讓全平台無法上傳）', async () => {
    expect(await codeOf(setup(1, 10 * MIB, null).capacity.assertCanStore(1))).toBeUndefined();
    const old = new Date(NOW.getTime() - STORAGE_TOTAL_STALE_AFTER_MS - 1);
    expect(await codeOf(setup(1, 10 * MIB, old).capacity.assertCanStore(1))).toBeUndefined();

    const recent = new Date(NOW.getTime() - STORAGE_TOTAL_STALE_AFTER_MS + 1000);
    expect(await codeOf(setup(1, 10 * MIB, recent).capacity.assertCanStore(1))).toBe(
      'STORAGE_TOTAL_LIMIT_REACHED',
    );
  });

  it('平台 DB 讀不到：放行', async () => {
    const { capacity, repo } = setup(1, 0);
    repo.total.mockRejectedValueOnce(new Error('connection refused'));
    await expect(capacity.assertCanStore(10 * MIB)).resolves.toBeUndefined();
  });

  it('合計在程序內快取 30 秒；同時的請求只查一次；invalidate 之後重查', async () => {
    const { capacity, repo } = setup(100, 0);
    await Promise.all([capacity.assertCanStore(1), capacity.assertCanStore(1)]);
    expect(repo.total).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(29_000);
    await capacity.assertCanStore(1);
    expect(repo.total).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(2_000);
    await capacity.assertCanStore(1);
    expect(repo.total).toHaveBeenCalledTimes(2);

    capacity.invalidate();
    await capacity.total();
    expect(repo.total).toHaveBeenCalledTimes(3);
  });

  it('上限以 MB（1024 × 1024 位元組）計', () => {
    expect(setup(3, 0).capacity.limitBytes).toBe(3 * MIB);
  });
});
