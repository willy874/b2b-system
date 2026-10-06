import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuditLogRow } from '@/db/schema';

import type { AuditLogRepository } from '../audit-log.repository';
import { AuditLogService } from '../audit-log.service';
import type { ListAuditLogDto } from '../dto/list-audit-log.dto';

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-10-06T00:00:00.000Z');

const ROW: AuditLogRow = {
  id: 9_007_199_254_740_993n,
  occurredAt: new Date('2026-10-05T12:00:00.000Z'),
  actorId: 'u-1',
  actorEmail: 'admin@example.com',
  action: 'role.update',
  resourceType: 'role',
  resourceId: 'r-1',
  resourceName: 'Editors',
  result: 'success',
  errorCode: null,
  changes: { before: { name: 'A' }, after: { name: 'B' } },
  metadata: { requestId: 'req-1' },
};

describe('AuditLogService（docs/architecture/backend/06-audit-log.md §7）', () => {
  let repo: { list: ReturnType<typeof vi.fn>; findById: ReturnType<typeof vi.fn> };
  let service: AuditLogService;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    repo = {
      list: vi.fn(async () => ({ items: [], total: 0 })),
      findById: vi.fn(async () => ROW),
    };
    service = new AuditLogService(repo as unknown as AuditLogRepository);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('list', () => {
    it('沒帶時間範圍 → 以現在往前 90 天查詢', async () => {
      const query: ListAuditLogDto = { offset: 0, limit: 50 };
      await service.list(query);
      expect(repo.list).toHaveBeenCalledWith(query, {
        from: new Date(NOW.getTime() - 90 * DAY),
        to: NOW,
      });
    });

    it('帶了範圍 → 原樣交給 repository', async () => {
      const range = {
        from: new Date('2026-09-01T00:00:00.000Z'),
        to: new Date('2026-09-30T00:00:00.000Z'),
      };
      await service.list({ offset: 0, limit: 50, ...range });
      expect(repo.list).toHaveBeenCalledWith(expect.anything(), range);
    });

    it('回摘要：bigint id 轉字串（不失精度）、時間轉 ISO，不含 changes / metadata', async () => {
      const { changes: _changes, metadata: _metadata, ...summary } = ROW;
      repo.list.mockResolvedValueOnce({ items: [summary], total: 1 });
      const result = await service.list({ offset: 0, limit: 50 });
      expect(result).toEqual({
        items: [
          {
            id: '9007199254740993',
            occurredAt: '2026-10-05T12:00:00.000Z',
            actorId: 'u-1',
            actorEmail: 'admin@example.com',
            action: 'role.update',
            resourceType: 'role',
            resourceId: 'r-1',
            resourceName: 'Editors',
            result: 'success',
            errorCode: null,
          },
        ],
        pagination: { offset: 0, limit: 50, total: 1 },
      });
    });
  });

  describe('findOne', () => {
    it('以 bigint 查詢，回完整紀錄（含 changes 與 metadata）', async () => {
      const log = await service.findOne('9007199254740993');
      expect(repo.findById).toHaveBeenCalledWith(9_007_199_254_740_993n);
      expect(log).toMatchObject({
        id: '9007199254740993',
        changes: { before: { name: 'A' }, after: { name: 'B' } },
        metadata: { requestId: 'req-1' },
      });
    });

    it('沒有 changes / metadata 的紀錄 → 兩者為 null', async () => {
      repo.findById.mockResolvedValueOnce({ ...ROW, changes: null, metadata: null });
      await expect(service.findOne('1')).resolves.toMatchObject({ changes: null, metadata: null });
    });

    it.each([['abc'], ['1.5'], ['1e3'], ['12abc'], [''], ['0x1f'], [' 1'], ['-1']])(
      'id %j 不是整數 → VALIDATION_FAILED（不查詢）',
      async (id) => {
        await expect(service.findOne(id)).rejects.toMatchObject({
          code: 'VALIDATION_FAILED',
          details: { fields: { id: 'must be a numeric id' } },
        });
        expect(repo.findById).not.toHaveBeenCalled();
      },
    );

    it('查無 → 404 AUDIT_LOG_NOT_FOUND', async () => {
      repo.findById.mockResolvedValueOnce(undefined);
      await expect(service.findOne('42')).rejects.toMatchObject({ code: 'AUDIT_LOG_NOT_FOUND' });
    });

    it('超出 bigint 範圍 → AUDIT_LOG_NOT_FOUND（不查詢）', async () => {
      await expect(service.findOne('9223372036854775808')).rejects.toMatchObject({
        code: 'AUDIT_LOG_NOT_FOUND',
      });
      expect(repo.findById).not.toHaveBeenCalled();
    });
  });
});
