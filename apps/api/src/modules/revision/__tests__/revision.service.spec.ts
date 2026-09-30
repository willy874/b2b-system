import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Env } from '@/core/config';
import type { DbOrTx } from '@/core/database';
import type { JobQueue } from '@/core/jobs';
import type { SettingService } from '@/core/settings';

import { REVISION_PRUNE_JOB, RevisionPruneJob } from '../revision-prune.job';
import { REVISION_PRUNE_BATCH_SIZE, REVISION_SNAPSHOT_MAX_BYTES } from '../revision.constants';
import type { RevisionRepository } from '../revision.repository';
import { RevisionService } from '../revision.service';

const TX = {} as DbOrTx;
const NOW = new Date('2026-10-31T00:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;

describe('RevisionService（docs/architecture/backend/14-revisions.md）', () => {
  let repo: {
    insertNext: ReturnType<typeof vi.fn>;
    find: ReturnType<typeof vi.fn>;
    pruneBatch: ReturnType<typeof vi.fn>;
  };
  let service: RevisionService;

  beforeEach(() => {
    repo = {
      insertNext: vi.fn(async () => 3),
      find: vi.fn(async () => undefined),
      pruneBatch: vi.fn(async () => 0),
    };
    const settings = {
      get: vi.fn(async (setting: { key: string }) =>
        setting.key === 'revision.keepVersions' ? 50 : 90,
      ),
    } as unknown as SettingService;
    service = new RevisionService(repo as unknown as RevisionRepository, settings);
  });

  describe('record', () => {
    it('在呼叫端的交易內寫入快照並回傳版本號', async () => {
      const snapshot = { name: 'A', description: null, permissionKeys: [] };
      const version = await service.record(TX, {
        resourceType: 'role',
        resourceId: 'r-1',
        snapshot,
        actorId: 'u-1',
      });
      expect(version).toBe(3);
      expect(repo.insertNext).toHaveBeenCalledWith(
        { resourceType: 'role', resourceId: 'r-1', snapshot, actorId: 'u-1' },
        TX,
      );
    });

    it('超過 1 MiB → snapshot 存 null、記 warn，不拋錯（業務寫入不能因為版本歷史失敗）', async () => {
      const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
      const snapshot = { description: 'x'.repeat(REVISION_SNAPSHOT_MAX_BYTES) };
      await expect(
        service.record(TX, { resourceType: 'role', resourceId: 'r-1', snapshot, actorId: null }),
      ).resolves.toBe(3);
      expect(repo.insertNext).toHaveBeenCalledWith(expect.objectContaining({ snapshot: null }), TX);
      expect(warn).toHaveBeenCalledOnce();
      warn.mockRestore();
    });

    it('以 UTF-8 位元組計算上限：剛好 1 MiB 仍保存', async () => {
      // {"d":"…"} 的外框 8 個位元組
      const snapshot = { d: 'x'.repeat(REVISION_SNAPSHOT_MAX_BYTES - 8) };
      await service.record(TX, {
        resourceType: 'role',
        resourceId: 'r-1',
        snapshot,
        actorId: null,
      });
      expect(repo.insertNext).toHaveBeenCalledWith(expect.objectContaining({ snapshot }), TX);
    });
  });

  describe('get / getSnapshot', () => {
    it('不存在 → REVISION_NOT_FOUND', async () => {
      await expect(service.get('role', 'r-1', 9)).rejects.toMatchObject({
        code: 'REVISION_NOT_FOUND',
      });
    });

    it('過大未保存 → getSnapshot 回 409 REVISION_UNAVAILABLE（reason: tooLarge）', async () => {
      repo.find.mockResolvedValueOnce({
        version: 2,
        createdAt: NOW,
        tooLarge: true,
        actor: null,
        snapshot: null,
      });
      await expect(service.getSnapshot('role', 'r-1', 2)).rejects.toMatchObject({
        code: 'REVISION_UNAVAILABLE',
        details: { version: 2, reason: 'tooLarge' },
      });
    });
  });

  describe('prune', () => {
    it('依設定算出截止時間，分批刪到不滿一批為止', async () => {
      repo.pruneBatch.mockResolvedValueOnce(REVISION_PRUNE_BATCH_SIZE).mockResolvedValueOnce(7);
      const report = await service.prune(NOW);
      const cutoff = new Date(NOW.getTime() - 90 * DAY_MS);
      expect(report).toEqual({
        keepVersions: 50,
        keepDays: 90,
        cutoff: cutoff.toISOString(),
        deleted: REVISION_PRUNE_BATCH_SIZE + 7,
      });
      expect(repo.pruneBatch).toHaveBeenCalledTimes(2);
      expect(repo.pruneBatch).toHaveBeenCalledWith(50, cutoff, REVISION_PRUNE_BATCH_SIZE);
    });
  });

  it('revision.prune 以 REVISION_PRUNE_CRON 註冊成 tenant 範圍的排程工作', () => {
    const register = vi.fn();
    const job = new RevisionPruneJob(
      service,
      { register } as unknown as JobQueue,
      { get: vi.fn(() => '45 4 * * *') } as unknown as ConfigService<Env, true>,
    );
    job.onModuleInit();
    expect(REVISION_PRUNE_JOB.options).toMatchObject({ scope: 'tenant', exclusive: true });
    expect(register).toHaveBeenCalledWith(REVISION_PRUNE_JOB, expect.any(Function), {
      cron: '45 4 * * *',
    });
  });
});
