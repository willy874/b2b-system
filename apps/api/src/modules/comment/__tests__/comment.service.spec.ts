import { ChangeKind, ChangeSource } from '@b2b-system/realtime';
import { describe, expect, it, vi } from 'vitest';

import type { Database } from '@/core/database';
import { AppException } from '@/core/errors';
import type { DomainEventBus } from '@/core/events';
import { encodeTimeIdCursor } from '@/core/http';
import type { CommentRow } from '@/db/schema';
import type { AuditService } from '@/modules/audit-log/audit.service';
import type { NotificationInput } from '@/modules/notification/notification.definition';
import type { NotificationService } from '@/modules/notification/notification.service';
import type { PermissionService } from '@/modules/permission/permission.service';

import type { CommentRepository, CommentUser, CommentWithAuthor } from '../comment.repository';
import { CommentService, excerptOf } from '../comment.service';
import type { WatchService } from '../watch.service';
import {
  ACTOR,
  commentRow,
  expectCode,
  inTenant,
  OTHER,
  registryWith,
  RESOURCE_ID,
  TARGET,
  THIRD,
} from './comment.fixture';

function user(id: string): CommentUser {
  return { id, displayName: `使用者 ${id.slice(-2)}`, email: `${id.slice(-2)}@example.com` };
}

function setup(options: { viewers?: string[]; watchers?: string[]; canModerate?: boolean } = {}) {
  const tx = { tx: true };
  const db = { transaction: vi.fn(async (fn: (t: unknown) => unknown) => fn(tx)) };
  const repo = {
    list: vi.fn(async (): Promise<CommentWithAuthor[]> => []),
    findById: vi.fn(async (): Promise<CommentRow | undefined> => commentRow()),
    findVersion: vi.fn(async (): Promise<number | undefined> => 2),
    create: vi.fn(async (values: Partial<CommentRow>) => commentRow(values)),
    update: vi.fn(
      async (_id: string, values: Partial<CommentRow>): Promise<CommentRow | undefined> =>
        commentRow({ ...values, version: 2, editedAt: new Date() }),
    ),
    delete: vi.fn(async () => true),
    removeAllFor: vi.fn(async () => undefined),
    usersByIds: vi.fn(async (ids: readonly string[]) => ids.map(user)),
    findMentionable: vi.fn(async (ids: readonly string[]) => [...ids]),
    searchMentionable: vi.fn(async (): Promise<CommentUser[]> =>
      [ACTOR.id, OTHER, THIRD].map(user),
    ),
  };
  const watches = {
    watcherIds: vi.fn(async () => options.watchers ?? []),
    watchInTx: vi.fn(async () => true),
    removeAllFor: vi.fn(async () => undefined),
    publishWatchChanged: vi.fn(),
  };
  const permissions = {
    getPermissionSet: vi.fn(async () => ({
      permissions: new Set(options.canModerate ? ['comment:delete'] : []),
      isSuperAdmin: false,
    })),
    assertHasAll: vi.fn(async () => undefined),
  };
  const notifications = { notify: vi.fn(async (_inputs: NotificationInput[]) => undefined) };
  const audit = {
    record: vi.fn(async () => undefined),
    recordSafely: vi.fn(async () => undefined),
  };
  const events = { publish: vi.fn() };
  const { registry, definition } = registryWith({ viewers: options.viewers });
  const service = new CommentService(
    db as unknown as Database,
    repo as unknown as CommentRepository,
    registry,
    watches as unknown as WatchService,
    permissions as unknown as PermissionService,
    notifications as unknown as NotificationService,
    audit as unknown as AuditService,
    events as unknown as DomainEventBus,
  );
  return { service, repo, watches, permissions, notifications, audit, events, definition, tx };
}

/** `notify()` 收到的每一筆：類型與收件人。 */
function notified(notifications: { notify: ReturnType<typeof vi.fn> }) {
  return notifications.notify.mock.calls.flatMap(([inputs]) =>
    (inputs as NotificationInput[]).map((input) => [input.type, input.recipientId]),
  );
}

describe('excerptOf（通知的留言摘要）', () => {
  it('空白壓成一個；超過 100 字截斷並加刪節號', () => {
    expect(excerptOf('  第一行\n\n第二行  ')).toBe('第一行 第二行');
    expect(excerptOf('字'.repeat(120))).toBe(`${'字'.repeat(100)}…`);
  });
});

describe('CommentService：登記（docs/architecture/backend/24-comment.md §8.2 D2）', () => {
  it('同一種資源登記兩次讓啟動失敗', () => {
    const { service, definition } = setup();
    expect(() => service.registerResource(definition)).toThrow('重複登記');
  });

  it('沒有登記的資源類型回 COMMENT_RESOURCE_TYPE_UNKNOWN', async () => {
    const { service } = setup();
    await expectCode(
      inTenant(() => service.list('webhook', RESOURCE_ID, { limit: 20 }, ACTOR)),
      'COMMENT_RESOURCE_TYPE_UNKNOWN',
      { resourceType: 'webhook' },
    );
  });

  it('所屬 feature 沒啟用回 FEATURE_DISABLED', async () => {
    const ctx = setup();
    const { registry } = registryWith({ feature: 'file' });
    const service = new CommentService(
      {} as Database,
      ctx.repo as unknown as CommentRepository,
      registry,
      ctx.watches as unknown as WatchService,
      ctx.permissions as unknown as PermissionService,
      ctx.notifications as unknown as NotificationService,
      ctx.audit as unknown as AuditService,
      ctx.events as unknown as DomainEventBus,
    );
    await expectCode(
      inTenant(() => service.list('user', RESOURCE_ID, { limit: 20 }, ACTOR), []),
      'FEATURE_DISABLED',
    );
  });
});

describe('CommentService.list', () => {
  function row(id: string, authorId: string, mentions: string[] = []): CommentWithAuthor {
    return {
      comment: commentRow({ id, authorId, mentions }),
      author: user(authorId),
      createdAtExact: '2026-10-08T00:00:00.123456Z',
    };
  }

  it('要看得到資源（擁有者判斷，帶路由），否則原樣拋出', async () => {
    const ctx = setup();
    ctx.definition.resolveViewable.mockRejectedValueOnce(new AppException('USER_NOT_FOUND'));
    await expectCode(
      inTenant(() => ctx.service.list('user', RESOURCE_ID, { limit: 20 }, ACTOR)),
      'USER_NOT_FOUND',
    );
    expect(ctx.definition.resolveViewable).toHaveBeenCalledWith(ACTOR, RESOURCE_ID, {
      route: 'GET /comments/:resourceType/:resourceId',
      metadata: { resourceType: 'user', resourceId: RESOURCE_ID },
    });
  });

  it('作者能改能刪、別人的都不能；被提及的人帶名稱', async () => {
    const ctx = setup();
    ctx.repo.list.mockResolvedValue([row('c1', ACTOR.id, [THIRD]), row('c2', OTHER)]);
    const page = await inTenant(() => ctx.service.list('user', RESOURCE_ID, { limit: 20 }, ACTOR));
    expect(page.items.map((item) => [item.id, item.canEdit, item.canDelete])).toEqual([
      ['c1', true, true],
      ['c2', false, false],
    ]);
    expect(page.items[0]?.mentions).toEqual([user(THIRD)]);
    expect(page.nextCursor).toBeNull();
  });

  it('持有 comment:delete 的人能刪別人的留言，但不能改', async () => {
    const ctx = setup({ canModerate: true });
    ctx.repo.list.mockResolvedValue([row('c2', OTHER)]);
    const page = await inTenant(() => ctx.service.list('user', RESOURCE_ID, { limit: 20 }, ACTOR));
    expect(page.items[0]).toMatchObject({ canEdit: false, canDelete: true });
  });

  it('滿一頁才有下一頁的游標（資料庫的微秒時間）', async () => {
    const ctx = setup();
    ctx.repo.list.mockResolvedValue([row('00000000-0000-4000-8000-000000000c02', OTHER)]);
    const page = await inTenant(() => ctx.service.list('user', RESOURCE_ID, { limit: 1 }, ACTOR));
    expect(page.nextCursor).toBe(
      encodeTimeIdCursor({
        createdAt: '2026-10-08T00:00:00.123456Z',
        id: '00000000-0000-4000-8000-000000000c02',
      }),
    );
  });

  it('游標格式不對回 VALIDATION_FAILED', async () => {
    const ctx = setup();
    await expectCode(
      inTenant(() => ctx.service.list('user', RESOURCE_ID, { limit: 20, cursor: 'xx' }, ACTOR)),
      'VALIDATION_FAILED',
      { field: 'cursor' },
    );
  });
});

describe('CommentService.create', () => {
  it('寫入、作者自動關注、推播留言（refs 帶所在的資源）與自己的關注', async () => {
    const ctx = setup();
    const created = await inTenant(() =>
      ctx.service.create('user', RESOURCE_ID, { body: '你好', mentionIds: [] }, ACTOR),
    );
    expect(created).toMatchObject({ body: '你好', canEdit: true, canDelete: true });
    expect(ctx.repo.create).toHaveBeenCalledWith(
      {
        resourceType: 'user',
        resourceId: RESOURCE_ID,
        authorId: ACTOR.id,
        body: '你好',
        mentions: [],
      },
      ctx.tx,
    );
    expect(ctx.watches.watchInTx).toHaveBeenCalledWith('user', RESOURCE_ID, ACTOR.id, ctx.tx);
    expect(ctx.events.publish).toHaveBeenCalledWith('resource.changed', {
      changes: [
        {
          resource: ChangeSource.COMMENT,
          kind: ChangeKind.CREATE,
          id: created.id,
          refs: { [ChangeSource.USER]: [RESOURCE_ID] },
        },
      ],
    });
    expect(ctx.watches.publishWatchChanged).toHaveBeenCalledWith(ACTOR.id, RESOURCE_ID);
    // 沒有收件人時不呼叫 notify
    expect(ctx.notifications.notify).not.toHaveBeenCalled();
  });

  it('已經在關注時不推關注的變更', async () => {
    const ctx = setup();
    ctx.watches.watchInTx.mockResolvedValue(false);
    await inTenant(() =>
      ctx.service.create('user', RESOURCE_ID, { body: '你好', mentionIds: [] }, ACTOR),
    );
    expect(ctx.watches.publishWatchChanged).not.toHaveBeenCalled();
  });

  it('被提及的人收提及；關注者收新留言（不含作者、已被提及的人、看不到資源的人）', async () => {
    const ctx = setup({
      viewers: [ACTOR.id, OTHER, THIRD],
      watchers: [ACTOR.id, OTHER, THIRD, 'not-viewer'],
    });
    await inTenant(() =>
      ctx.service.create('user', RESOURCE_ID, { body: '@某人 看一下', mentionIds: [OTHER] }, ACTOR),
    );
    expect(notified(ctx.notifications)).toEqual([
      ['comment.mentioned', OTHER],
      ['comment.created', THIRD],
    ]);
    const inputs = ctx.notifications.notify.mock.calls[0]?.[0] ?? [];
    expect(inputs[0]).toMatchObject({
      actorId: ACTOR.id,
      params: { resourceType: 'user', resourceName: TARGET.name, excerpt: '@某人 看一下' },
      link: TARGET.link,
    });
  });

  it('被提及的人看不到資源或不能被提及（停用、刪除）：COMMENT_MENTION_INVALID，不寫入', async () => {
    const ctx = setup({ viewers: [ACTOR.id, OTHER] });
    ctx.repo.findMentionable.mockResolvedValue([OTHER, THIRD]);
    await expectCode(
      inTenant(() =>
        ctx.service.create(
          'user',
          RESOURCE_ID,
          { body: '看一下', mentionIds: [OTHER, THIRD, 'inactive'] },
          ACTOR,
        ),
      ),
      'COMMENT_MENTION_INVALID',
      { userIds: [THIRD, 'inactive'] },
    );
    expect(ctx.repo.create).not.toHaveBeenCalled();
  });
});

describe('CommentService.update', () => {
  it('不是作者：AUTHZ_FORBIDDEN，並寫 authz.denied', async () => {
    const ctx = setup();
    ctx.repo.findById.mockResolvedValue(commentRow({ authorId: OTHER }));
    await expectCode(
      inTenant(() => ctx.service.update('c1', { body: '改', mentionIds: [], version: 1 }, ACTOR)),
      'AUTHZ_FORBIDDEN',
      { reason: 'notAuthor' },
    );
    expect(ctx.audit.recordSafely).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'authz.denied',
        metadata: expect.objectContaining({ route: 'PATCH /comments/:id' }),
      }),
    );
    expect(ctx.repo.update).not.toHaveBeenCalled();
  });

  it('留言不存在：COMMENT_NOT_FOUND', async () => {
    const ctx = setup();
    ctx.repo.findById.mockResolvedValue(undefined);
    await expectCode(
      inTenant(() => ctx.service.update('c1', { body: '改', mentionIds: [], version: 1 }, ACTOR)),
      'COMMENT_NOT_FOUND',
    );
  });

  it('版本不符：COMMENT_VERSION_CONFLICT（讀到時與條件式 UPDATE 沒命中時）', async () => {
    const ctx = setup();
    ctx.repo.findById.mockResolvedValue(commentRow({ version: 3 }));
    await expectCode(
      inTenant(() => ctx.service.update('c1', { body: '改', mentionIds: [], version: 1 }, ACTOR)),
      'COMMENT_VERSION_CONFLICT',
      { current: 3 },
    );
    ctx.repo.findById.mockResolvedValue(commentRow());
    ctx.repo.update.mockResolvedValue(undefined);
    await expectCode(
      inTenant(() => ctx.service.update('c1', { body: '改', mentionIds: [], version: 1 }, ACTOR)),
      'COMMENT_VERSION_CONFLICT',
      { current: 2 },
    );
  });

  it('只通知新加入的被提及者；原本提及的人失去權限也不擋編輯', async () => {
    const ctx = setup({ viewers: [ACTOR.id, THIRD] });
    ctx.repo.findById.mockResolvedValue(commentRow({ mentions: [OTHER] }));
    const updated = await inTenant(() =>
      ctx.service.update('c1', { body: '改', mentionIds: [OTHER, THIRD], version: 1 }, ACTOR),
    );
    expect(notified(ctx.notifications)).toEqual([['comment.mentioned', THIRD]]);
    expect(ctx.repo.update).toHaveBeenCalledWith(
      'c1',
      { body: '改', mentions: [OTHER, THIRD] },
      1,
      ctx.tx,
    );
    expect(updated.version).toBe(2);
    expect(ctx.events.publish).toHaveBeenCalledWith(
      'resource.changed',
      expect.objectContaining({
        changes: [expect.objectContaining({ kind: ChangeKind.UPDATE })],
      }),
    );
  });
});

describe('CommentService.remove', () => {
  it('作者刪自己的：不檢查 comment:delete、不寫稽核', async () => {
    const ctx = setup();
    await inTenant(() => ctx.service.remove('c1', ACTOR));
    expect(ctx.permissions.assertHasAll).not.toHaveBeenCalled();
    expect(ctx.audit.record).not.toHaveBeenCalled();
    expect(ctx.events.publish).toHaveBeenCalledWith(
      'resource.changed',
      expect.objectContaining({
        changes: [expect.objectContaining({ kind: ChangeKind.DELETE })],
      }),
    );
  });

  it('刪別人的：要 comment:delete（帶路由），拒絕時原樣拋出、不刪', async () => {
    const ctx = setup();
    ctx.repo.findById.mockResolvedValue(commentRow({ authorId: OTHER }));
    ctx.permissions.assertHasAll.mockRejectedValueOnce(new AppException('AUTHZ_FORBIDDEN'));
    await expectCode(
      inTenant(() => ctx.service.remove('c1', ACTOR)),
      'AUTHZ_FORBIDDEN',
    );
    expect(ctx.permissions.assertHasAll).toHaveBeenCalledWith(ACTOR, ['comment:delete'], {
      route: 'DELETE /comments/:id',
      metadata: { commentId: 'c1' },
    });
    expect(ctx.repo.delete).not.toHaveBeenCalled();
  });

  it('管理者刪別人的：寫稽核 comment.delete（帶所在資源與作者）', async () => {
    const ctx = setup();
    ctx.repo.findById.mockResolvedValue(commentRow({ id: 'c1', authorId: OTHER }));
    await inTenant(() => ctx.service.remove('c1', ACTOR));
    expect(ctx.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'comment.delete',
        resourceType: 'comment',
        resourceId: 'c1',
        resourceName: TARGET.name,
        metadata: { targetType: 'user', targetId: RESOURCE_ID, authorId: OTHER },
      }),
      ctx.tx,
    );
  });

  it('同時被刪掉：COMMENT_NOT_FOUND', async () => {
    const ctx = setup();
    ctx.repo.delete.mockResolvedValue(false);
    await expectCode(
      inTenant(() => ctx.service.remove('c1', ACTOR)),
      'COMMENT_NOT_FOUND',
    );
  });
});

describe('CommentService.mentionable', () => {
  it('只回看得到資源的人', async () => {
    const ctx = setup({ viewers: [ACTOR.id, THIRD] });
    const { items } = await inTenant(() =>
      ctx.service.mentionable('user', RESOURCE_ID, '使用者', ACTOR),
    );
    expect(items.map((item) => item.id)).toEqual([ACTOR.id, THIRD]);
    expect(ctx.repo.searchMentionable).toHaveBeenCalledWith('使用者', 50);
  });
});

describe('CommentService.removeAllFor', () => {
  it('在擁有者的交易內清掉留言與關注（D10）', async () => {
    const ctx = setup();
    const tx = { owner: true };
    await ctx.service.removeAllFor('user', [RESOURCE_ID], tx as never);
    expect(ctx.repo.removeAllFor).toHaveBeenCalledWith('user', [RESOURCE_ID], tx);
    expect(ctx.watches.removeAllFor).toHaveBeenCalledWith('user', [RESOURCE_ID], tx);
  });
});
