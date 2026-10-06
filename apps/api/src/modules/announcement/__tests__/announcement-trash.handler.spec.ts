import { ChangeKind, ChangeSource } from '@b2b-system/realtime';
import { describe, expect, it, vi } from 'vitest';

import { PERMISSION } from '@/common/types';
import type { Transaction } from '@/core/database';
import { DomainEvent } from '@/core/events';
import type { DomainEventBus } from '@/core/events';
import type { TrashService } from '@/modules/trash/trash.service';

import { AnnouncementTrashHandler } from '../announcement-trash.handler';
import type { AnnouncementRepository, DeletedAnnouncementRow } from '../announcement.repository';

const DELETED_AT = new Date('2026-10-04T00:00:00.000Z');

function setup() {
  const repo = {
    listDeleted: vi.fn(async (): Promise<{ items: DeletedAnnouncementRow[]; total: number }> => ({
      items: [
        {
          id: 'ann-1',
          title: '季度說明會',
          status: 'paused',
          deletedAt: DELETED_AT,
          deletedBy: { id: 'actor-1', name: 'Actor' },
        },
      ],
      total: 4,
    })),
    findExpired: vi.fn(async () => [{ id: 'ann-1', name: '季度說明會', deletedAt: DELETED_AT }]),
    hardDelete: vi.fn(async () => true),
  };
  const trash = { registerHandler: vi.fn() };
  const events = { publish: vi.fn() };
  const handler = new AnnouncementTrashHandler(
    trash as unknown as TrashService,
    repo as unknown as AnnouncementRepository,
    events as unknown as DomainEventBus,
  );
  return { handler, repo, trash, events };
}

describe('AnnouncementTrashHandler（docs/architecture/backend/19-announcement.md §9.2 D19）', () => {
  it('模組初始化時向回收桶註冊自己', () => {
    const { handler, trash } = setup();
    handler.onModuleInit();
    expect(trash.registerHandler).toHaveBeenCalledWith(handler);
  });

  it('需要 announcement:delete、屬於 announcement feature', () => {
    const { handler } = setup();
    expect(handler.type).toBe('announcement');
    expect(handler.permission).toBe(PERMISSION.ANNOUNCEMENT_DELETE);
    expect(handler.feature).toBe('announcement');
  });

  it('列出：名稱是標題，沒有次要資訊，帶刪除者與時間', async () => {
    const { handler, repo } = setup();
    const query = { offset: 0, limit: 20, keyword: '說明' };
    const result = await handler.listDeleted(query);
    expect(repo.listDeleted).toHaveBeenCalledWith(query);
    expect(result).toEqual({
      items: [
        {
          id: 'ann-1',
          name: '季度說明會',
          description: null,
          deletedAt: DELETED_AT,
          deletedBy: { id: 'actor-1', name: 'Actor' },
        },
      ],
      total: 4,
    });
  });

  it('到期的項目交給 repository 以 keyset 分批取出', async () => {
    const { handler, repo } = setup();
    const cutoff = new Date('2026-09-06T00:00:00.000Z');
    await handler.findExpired(cutoff, 'ann-0', 100);
    expect(repo.findExpired).toHaveBeenCalledWith(cutoff, 'ann-0', 100);
  });

  it('永久刪除在回收桶給的交易內，回報有沒有刪到', async () => {
    const { handler, repo } = setup();
    const tx = { name: 'tx' } as unknown as Transaction;
    repo.hardDelete.mockResolvedValueOnce(false);
    expect(
      await handler.purge({ id: 'ann-1', name: '季度說明會', deletedAt: DELETED_AT }, tx),
    ).toBe(false);
    expect(repo.hardDelete).toHaveBeenCalledWith('ann-1', tx);
  });

  it('永久刪除之後一次發布所有項目的 delete', async () => {
    const { handler, events } = setup();
    await handler.afterPurge(['ann-1', 'ann-2']);
    expect(events.publish).toHaveBeenCalledWith(DomainEvent.RESOURCE_CHANGED, {
      changes: [
        { resource: ChangeSource.ANNOUNCEMENT, kind: ChangeKind.DELETE, id: 'ann-1' },
        { resource: ChangeSource.ANNOUNCEMENT, kind: ChangeKind.DELETE, id: 'ann-2' },
      ],
    });
  });
});
