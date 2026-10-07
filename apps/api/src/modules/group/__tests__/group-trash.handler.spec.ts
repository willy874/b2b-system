import { describe, expect, it, vi } from 'vitest';

import type { Transaction } from '@/core/database';
import { DomainEvent } from '@/core/events';
import type { DomainEventBus } from '@/core/events';
import type { PermissionService } from '@/modules/permission/permission.service';
import type { TrashService } from '@/modules/trash/trash.service';

import { GroupTrashHandler } from '../group-trash.handler';
import type { GroupRepository } from '../group.repository';

function createHandler() {
  const order: string[] = [];
  const trash = { registerHandler: vi.fn() };
  const repo = {
    listDeleted: vi.fn().mockResolvedValue({ items: [], total: 0 }),
    findExpired: vi.fn().mockResolvedValue([]),
    hardDelete: vi.fn().mockResolvedValue(true),
  };
  const permissions = {
    permissionsChanged: vi.fn(async () => {
      order.push('permissionsChanged');
    }),
  };
  const events = {
    publish: vi.fn(() => {
      order.push('publish');
    }),
  };
  const handler = new GroupTrashHandler(
    trash as unknown as TrashService,
    repo as unknown as GroupRepository,
    permissions as unknown as PermissionService,
    events as unknown as DomainEventBus,
  );
  return { handler, trash, repo, permissions, events, order };
}

describe('GroupTrashHandler（docs/architecture/iam/07-groups.md §4、docs/architecture/backend/14-revisions.md §9.2 D9）', () => {
  it('模組初始化時向回收桶註冊自己；看回收桶要 group:delete，排在角色（40）之後', () => {
    const { handler, trash } = createHandler();
    handler.onModuleInit();
    expect(trash.registerHandler).toHaveBeenCalledWith(handler);
    expect(handler.type).toBe('group');
    expect(handler.permission).toBe('group:delete');
    expect(handler.purgeOrder).toBe(50);
  });

  it('列出與找到期的列交給 repository（keyset 參數原樣傳入）', async () => {
    const { handler, repo } = createHandler();
    const cutoff = new Date(0);
    await handler.listDeleted({ offset: 0, limit: 20, keyword: '美' });
    await handler.findExpired(cutoff, 'g0', 100);
    expect(repo.listDeleted).toHaveBeenCalledWith({ offset: 0, limit: 20, keyword: '美' });
    expect(repo.findExpired).toHaveBeenCalledWith(cutoff, 'g0', 100);
  });

  it('purge 在呼叫端的交易內硬刪除，回傳是否刪掉', async () => {
    const { handler, repo } = createHandler();
    repo.hardDelete.mockResolvedValue(false);
    const tx = {} as Transaction;
    await expect(
      handler.purge({ id: 'g1', name: '美術', deletedAt: new Date(0) }, tx),
    ).resolves.toBe(false);
    expect(repo.hardDelete).toHaveBeenCalledWith('g1', tx);
  });

  it('afterPurge：先整個租戶 permissionsChanged，再以 delete 推播每個刪掉的群組', async () => {
    const { handler, permissions, events, order } = createHandler();
    await handler.afterPurge(['g1', 'g2']);
    expect(permissions.permissionsChanged).toHaveBeenCalledWith();
    expect(events.publish).toHaveBeenCalledWith(DomainEvent.RESOURCE_CHANGED, {
      changes: [
        { resource: 'group', kind: 'delete', id: 'g1' },
        { resource: 'group', kind: 'delete', id: 'g2' },
      ],
    });
    expect(order).toEqual(['permissionsChanged', 'publish']);
  });
});
