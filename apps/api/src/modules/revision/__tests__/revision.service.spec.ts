import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Env } from '@/core/config';
import type { DbOrTx } from '@/core/database';
import type { JobQueue } from '@/core/jobs';
import type { SettingService } from '@/core/settings';

import { REVISION_PRUNE_JOB, RevisionPruneJob } from '../revision-prune.job';
import { REVISION_PRUNE_BATCH_SIZE, REVISION_SNAPSHOT_MAX_BYTES } from '../revision.constants';
import type {
  RevisionDetailRow,
  RevisionRepository,
  RevisionSummaryRow,
} from '../revision.repository';
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

function buildService(keep: { versions?: number; days?: number } = {}) {
  const repo = {
    insertNext: vi.fn(async () => 1),
    list: vi.fn(async (): Promise<{ items: RevisionSummaryRow[]; total: number }> => ({
      items: [],
      total: 0,
    })),
    find: vi.fn(async (): Promise<RevisionDetailRow | undefined> => undefined),
    deleteAll: vi.fn(async () => 4),
    pruneBatch: vi.fn(async () => 0),
  };
  const settings = {
    get: vi.fn(async (setting: { key: string }) =>
      setting.key === 'revision.keepVersions' ? (keep.versions ?? 50) : (keep.days ?? 90),
    ),
  };
  const service = new RevisionService(
    repo as unknown as RevisionRepository,
    settings as unknown as SettingService,
  );
  return { service, repo };
}

describe('RevisionService：補充（docs/architecture/backend/14-revisions.md）', () => {
  const ACTOR = { id: '00000000-0000-4000-8000-000000000001', name: 'Alice' };

  describe('record：上限以 UTF-8 位元組計算', () => {
    it.each([
      // {"d":"…"} 的外框 8 個位元組；中文字一個 3 個位元組
      ['ASCII 剛好 1 MiB', 'x'.repeat(REVISION_SNAPSHOT_MAX_BYTES - 8), false],
      ['ASCII 超過 1 個位元組', 'x'.repeat(REVISION_SNAPSHOT_MAX_BYTES - 7), true],
      [
        '中文：字數未到上限但位元組超過',
        '字'.repeat(Math.ceil(REVISION_SNAPSHOT_MAX_BYTES / 3)),
        true,
      ],
      [
        '中文：位元組未到上限',
        '字'.repeat(Math.floor((REVISION_SNAPSHOT_MAX_BYTES - 8) / 3)),
        false,
      ],
    ])('%s → tooLarge = %s', async (_label, value, tooLarge) => {
      vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
      const { service, repo } = buildService();
      const snapshot = { d: value };
      await service.record(TX, {
        resourceType: 'role',
        resourceId: 'r-1',
        snapshot,
        actorId: null,
      });
      expect(repo.insertNext).toHaveBeenCalledWith(
        expect.objectContaining({ snapshot: tooLarge ? null : snapshot }),
        TX,
      );
      vi.restoreAllMocks();
    });

    it('快照過大仍佔一個版本號（回傳 repository 給的版本）', async () => {
      vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
      const { service, repo } = buildService();
      repo.insertNext.mockResolvedValueOnce(12);
      const snapshot = { d: 'x'.repeat(REVISION_SNAPSHOT_MAX_BYTES) };
      await expect(
        service.record(TX, { resourceType: 'role', resourceId: 'r-1', snapshot, actorId: 'u-1' }),
      ).resolves.toBe(12);
      vi.restoreAllMocks();
    });

    it('repository 寫入失敗 → 往外拋（讓業務交易回滾）', async () => {
      const { service, repo } = buildService();
      repo.insertNext.mockRejectedValueOnce(new Error('unique violation'));
      await expect(
        service.record(TX, {
          resourceType: 'role',
          resourceId: 'r-1',
          snapshot: {},
          actorId: null,
        }),
      ).rejects.toThrow('unique violation');
    });
  });

  describe('list', () => {
    it('以資源與分頁查詢，時間轉成 ISO 字串、帶分頁資訊', async () => {
      const { service, repo } = buildService();
      repo.list.mockResolvedValueOnce({
        items: [{ version: 3, createdAt: NOW, tooLarge: false, actor: ACTOR }],
        total: 3,
      });
      const result = await service.list('role', 'r-1', { offset: 0, limit: 1 });
      expect(repo.list).toHaveBeenCalledWith('role', 'r-1', 0, 1);
      expect(result).toEqual({
        items: [{ version: 3, createdAt: NOW.toISOString(), actor: ACTOR, tooLarge: false }],
        pagination: { offset: 0, limit: 1, total: 3 },
      });
    });
  });

  describe('get / getSnapshot', () => {
    const ROW = {
      version: 2,
      createdAt: NOW,
      tooLarge: false,
      actor: null,
      snapshot: { name: 'A' },
    };

    it('找到 → 摘要加上快照', async () => {
      const { service, repo } = buildService();
      repo.find.mockResolvedValueOnce(ROW);
      await expect(service.get('role', 'r-1', 2)).resolves.toEqual({
        version: 2,
        createdAt: NOW.toISOString(),
        actor: null,
        tooLarge: false,
        snapshot: { name: 'A' },
      });
      expect(repo.find).toHaveBeenCalledWith('role', 'r-1', 2);
    });

    it('getSnapshot 找到 → 只回快照', async () => {
      const { service, repo } = buildService();
      repo.find.mockResolvedValueOnce(ROW);
      await expect(service.getSnapshot('role', 'r-1', 2)).resolves.toEqual({ name: 'A' });
    });

    it('getSnapshot 找不到（已被保留清理刪除）→ REVISION_NOT_FOUND', async () => {
      const { service } = buildService();
      await expect(service.getSnapshot('role', 'r-1', 2)).rejects.toMatchObject({
        code: 'REVISION_NOT_FOUND',
      });
    });
  });

  describe('deleteAll', () => {
    it('在呼叫端的交易內刪除資源的所有版本，回傳筆數', async () => {
      const { service, repo } = buildService();
      await expect(service.deleteAll('role', 'r-1', TX)).resolves.toBe(4);
      expect(repo.deleteAll).toHaveBeenCalledWith('role', 'r-1', TX);
    });
  });

  describe('prune', () => {
    it('第一批就不滿 → 只刪一次', async () => {
      const { service, repo } = buildService();
      repo.pruneBatch.mockResolvedValueOnce(0);
      await expect(service.prune(NOW)).resolves.toMatchObject({ deleted: 0 });
      expect(repo.pruneBatch).toHaveBeenCalledOnce();
    });

    it('剛好滿一批而下一批為 0 → 刪兩次後停止', async () => {
      const { service, repo } = buildService();
      repo.pruneBatch.mockResolvedValueOnce(REVISION_PRUNE_BATCH_SIZE).mockResolvedValueOnce(0);
      await expect(service.prune(NOW)).resolves.toMatchObject({
        deleted: REVISION_PRUNE_BATCH_SIZE,
      });
      expect(repo.pruneBatch).toHaveBeenCalledTimes(2);
    });

    it('依設定的保留版本數與天數清理（設定改了下一輪就生效）', async () => {
      const { service, repo } = buildService({ versions: 5, days: 1 });
      const report = await service.prune(NOW);
      expect(report).toMatchObject({
        keepVersions: 5,
        keepDays: 1,
        cutoff: '2026-10-30T00:00:00.000Z',
      });
      expect(repo.pruneBatch).toHaveBeenCalledWith(
        5,
        new Date('2026-10-30T00:00:00.000Z'),
        REVISION_PRUNE_BATCH_SIZE,
      );
    });

    it('中途失敗 → 往外拋（已提交的批次已刪，重跑只剩還沒刪的）', async () => {
      const { service, repo } = buildService();
      repo.pruneBatch
        .mockResolvedValueOnce(REVISION_PRUNE_BATCH_SIZE)
        .mockRejectedValueOnce(new Error('lock timeout'));
      await expect(service.prune(NOW)).rejects.toThrow('lock timeout');
    });
  });
});

function buildJob(prune = vi.fn(async () => ({ deleted: 0 }))) {
  const register = vi.fn();
  const job = new RevisionPruneJob(
    { prune } as unknown as RevisionService,
    { register } as unknown as JobQueue,
    { get: vi.fn(() => '') } as unknown as ConfigService<Env, true>,
  );
  return { job, register, prune };
}

describe('RevisionPruneJob', () => {
  it('run 執行 RevisionService.prune 並回傳報告', async () => {
    const report = { keepVersions: 50, keepDays: 90, cutoff: NOW.toISOString(), deleted: 3 };
    const { job } = buildJob(vi.fn(async () => report));
    await expect(job.run()).resolves.toBe(report);
  });

  it('註冊的 handler 就是 run', async () => {
    const { job, register, prune } = buildJob();
    job.onModuleInit();
    const registered = register.mock.calls[0]?.[1] as () => Promise<unknown>;
    await registered();
    expect(prune).toHaveBeenCalledOnce();
  });

  it('REVISION_PRUNE_CRON 是空字串 → 註冊時 cron 為空（JobQueue 視為不排程）', () => {
    const { job, register } = buildJob();
    job.onModuleInit();
    expect(register).toHaveBeenCalledWith(REVISION_PRUNE_JOB, expect.any(Function), { cron: '' });
  });
});
