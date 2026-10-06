import { describe, expect, it, vi } from 'vitest';

import type { AuthUser } from '@/common/types';
import type { Database } from '@/core/database';
import { AppException } from '@/core/errors';
import type { DomainEventBus } from '@/core/events';
import { runInTenantContext } from '@/core/tenant';
import type { TenantContext, TenantFeature } from '@/core/tenant';
import type { TagRow } from '@/db/schema';
import type { AuditService } from '@/modules/audit-log/audit.service';

import { TAG_MAX_PER_RESOURCE, TAG_MAX_PER_SCOPE } from '../tag.constants';
import type { AssignedTag, TagRepository } from '../tag.repository';
import { TagService } from '../tag.service';

const ACTOR = { id: 'admin-1', email: 'admin@example.com' } as AuthUser;

function tag(id: string, overrides: Partial<TagRow> = {}): TagRow {
  return {
    id,
    scope: 'file',
    name: `標籤 ${id}`,
    color: 'neutral',
    version: 1,
    createdAt: new Date('2026-10-01T00:00:00Z'),
    createdBy: null,
    updatedAt: new Date('2026-10-01T00:00:00Z'),
    updatedBy: null,
    ...overrides,
  };
}

function assigned(resourceId: string, row: TagRow): AssignedTag {
  return { resourceId, id: row.id, name: row.name, color: 'neutral' };
}

function setup() {
  const tx = { tx: true };
  const db = { transaction: vi.fn(async (fn: (t: unknown) => unknown) => fn(tx)) };
  const repo = {
    listByScope: vi.fn(async (): Promise<TagRow[]> => [tag('t1')]),
    findById: vi.fn(async (): Promise<TagRow | undefined> => tag('t1')),
    findInScope: vi.fn(async (): Promise<TagRow[]> => []),
    countInScope: vi.fn(async () => 0),
    lockScope: vi.fn(async () => undefined),
    create: vi.fn(async (values: Partial<TagRow>) => tag('new', values)),
    update: vi.fn(async (_id: string, values: Partial<TagRow>) =>
      tag('t1', { ...values, version: 2 }),
    ),
    delete: vi.fn(async (): Promise<number | undefined> => 3),
    tagsOf: vi.fn(async (): Promise<AssignedTag[]> => []),
    replace: vi.fn(async () => undefined),
    removeAllFor: vi.fn(async () => undefined),
  };
  const audit = { record: vi.fn(async () => undefined) };
  const events = { publish: vi.fn() };
  const service = new TagService(
    db as unknown as Database,
    repo as unknown as TagRepository,
    audit as unknown as AuditService,
    events as unknown as DomainEventBus,
  );
  const canBrowse = vi.fn(async () => true);
  const resolveEditable = vi.fn(async () => ({ name: 'report.pdf' }));
  const afterTagsChanged = vi.fn();
  service.registerScope({ scope: 'file', feature: 'file', canBrowse });
  service.registerResource({
    resourceType: 'file',
    scope: 'file',
    resolveEditable,
    afterTagsChanged,
  });
  return { service, repo, audit, events, tx, canBrowse, resolveEditable, afterTagsChanged };
}

function inTenant<T>(fn: () => Promise<T>, features: TenantFeature[] = ['file']) {
  return runInTenantContext({ id: 't', code: 'acme', features } as unknown as TenantContext, fn);
}

async function expectCode(promise: Promise<unknown>, code: string, details?: object) {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(AppException);
  expect((error as AppException).code).toBe(code);
  if (details) expect((error as AppException).details).toMatchObject(details);
}

describe('TagService：登記（docs/architecture/backend/18-tag.md §7.2 D1、D7）', () => {
  it('同一個標籤組或資源類型登記兩次讓啟動失敗', () => {
    const { service } = setup();
    expect(() => service.registerScope({ scope: 'file', canBrowse: async () => true })).toThrow(
      '重複登記',
    );
    expect(() =>
      service.registerResource({
        resourceType: 'file',
        scope: 'file',
        resolveEditable: async () => ({ name: '' }),
        afterTagsChanged: () => undefined,
      }),
    ).toThrow('重複登記');
  });
});

describe('TagService：定義', () => {
  it('列表：要進得了標籤組，否則 AUTHZ_FORBIDDEN', async () => {
    const ctx = setup();
    expect((await inTenant(() => ctx.service.list('file', ACTOR))).items).toHaveLength(1);
    ctx.canBrowse.mockResolvedValue(false);
    await expectCode(
      inTenant(() => ctx.service.list('file', ACTOR)),
      'AUTHZ_FORBIDDEN',
    );
  });

  it('沒有登記的標籤組 → TAG_SCOPE_NOT_FOUND；所屬 feature 沒啟用 → FEATURE_DISABLED（D12）', async () => {
    const ctx = setup();
    await expectCode(
      inTenant(() => ctx.service.list('project', ACTOR)),
      'TAG_SCOPE_NOT_FOUND',
    );
    await expectCode(
      inTenant(() => ctx.service.list('file', ACTOR), []),
      'FEATURE_DISABLED',
    );
  });

  it('建立：鎖住標籤組再數，寫稽核、推播', async () => {
    const ctx = setup();
    const created = await inTenant(() =>
      ctx.service.create({ scope: 'file', name: '合約', color: 'brand' }, ACTOR),
    );
    expect(created).toMatchObject({ scope: 'file', name: '合約', color: 'brand' });
    expect(ctx.repo.lockScope).toHaveBeenCalledWith('file', ctx.tx);
    expect(ctx.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'tag.create', resourceType: 'tag' }),
      ctx.tx,
    );
    expect(ctx.events.publish).toHaveBeenCalledWith('resource.changed', {
      changes: [{ resource: 'tag', kind: 'create', id: 'new' }],
    });
  });

  it('標籤組已達上限 → TAG_LIMIT_REACHED', async () => {
    const ctx = setup();
    ctx.repo.countInScope.mockResolvedValue(TAG_MAX_PER_SCOPE);
    await expectCode(
      inTenant(() => ctx.service.create({ scope: 'file', name: 'x', color: 'neutral' }, ACTOR)),
      'TAG_LIMIT_REACHED',
      { max: TAG_MAX_PER_SCOPE },
    );
  });

  it('同名（唯一索引）→ TAG_NAME_DUPLICATE', async () => {
    const ctx = setup();
    ctx.repo.create.mockRejectedValue(
      Object.assign(new Error('duplicate'), {
        code: '23505',
        constraint_name: 'tags_scope_name_unique',
      }),
    );
    await expectCode(
      inTenant(() => ctx.service.create({ scope: 'file', name: '合約', color: 'neutral' }, ACTOR)),
      'TAG_NAME_DUPLICATE',
    );
  });

  it('改名：版本不符 → TAG_VERSION_CONFLICT；成功時稽核只記改變的欄位', async () => {
    const ctx = setup();
    await expectCode(
      inTenant(() => ctx.service.update('t1', { name: 'x', version: 9 }, ACTOR)),
      'TAG_VERSION_CONFLICT',
      { current: 1 },
    );
    await inTenant(() => ctx.service.update('t1', { name: '新名稱', version: 1 }, ACTOR));
    expect(ctx.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'tag.update',
        changes: { before: { name: '標籤 t1' }, after: { name: '新名稱' } },
      }),
      ctx.tx,
    );
  });

  it('刪除：硬刪除，稽核記下當時貼著的資源數（D4）', async () => {
    const ctx = setup();
    await ctx.service.remove('t1');
    expect(ctx.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'tag.delete', metadata: { assignedResources: 3 } }),
      ctx.tx,
    );
  });
});

describe('TagService.replaceFor（指派，D7）', () => {
  it('能不能改交給擁有者；寫稽核（前後的名稱），提交後由擁有者推播', async () => {
    const ctx = setup();
    const a = tag('a', { name: '合約' });
    const b = tag('b', { name: '急件' });
    ctx.repo.findInScope.mockResolvedValue([a, b]);
    ctx.repo.tagsOf
      .mockResolvedValueOnce([assigned('f1', a)])
      .mockResolvedValueOnce([assigned('f1', a), assigned('f1', b)]);

    const result = await inTenant(() =>
      ctx.service.replaceFor('file', 'f1', { tagIds: ['a', 'b'] }, ACTOR),
    );
    expect(ctx.resolveEditable).toHaveBeenCalledWith(ACTOR, 'f1');
    expect(ctx.repo.findInScope).toHaveBeenCalledWith('file', ['a', 'b'], ctx.tx);
    expect(ctx.repo.replace).toHaveBeenCalledWith('file', 'f1', ['a', 'b'], ACTOR.id, ctx.tx);
    expect(ctx.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'tag.assign',
        resourceType: 'file',
        resourceId: 'f1',
        resourceName: 'report.pdf',
        changes: { before: { tags: ['合約'] }, after: { tags: ['合約', '急件'] } },
        metadata: { added: ['b'], removed: [] },
      }),
      ctx.tx,
    );
    expect(ctx.afterTagsChanged).toHaveBeenCalledWith('f1');
    expect(result.tags.map((item) => item.id)).toEqual(['a', 'b']);
  });

  it('沒有改變：不寫入、不稽核、不推播', async () => {
    const ctx = setup();
    const a = tag('a');
    ctx.repo.findInScope.mockResolvedValue([a]);
    ctx.repo.tagsOf.mockResolvedValue([assigned('f1', a)]);
    await inTenant(() => ctx.service.replaceFor('file', 'f1', { tagIds: ['a'] }, ACTOR));
    expect(ctx.repo.replace).not.toHaveBeenCalled();
    expect(ctx.audit.record).not.toHaveBeenCalled();
    expect(ctx.afterTagsChanged).not.toHaveBeenCalled();
  });

  it('標籤不存在或不屬於這個資源的標籤組 → TAG_NOT_FOUND（帶 id）', async () => {
    const ctx = setup();
    ctx.repo.findInScope.mockResolvedValue([tag('a')]);
    await expectCode(
      inTenant(() => ctx.service.replaceFor('file', 'f1', { tagIds: ['a', 'user-tag'] }, ACTOR)),
      'TAG_NOT_FOUND',
      { tagIds: ['user-tag'] },
    );
    expect(ctx.repo.replace).not.toHaveBeenCalled();
  });

  it('擁有者拒絕（不能改目標）→ 原樣拋出，不寫入', async () => {
    const ctx = setup();
    ctx.resolveEditable.mockRejectedValue(new AppException('AUTHZ_FORBIDDEN'));
    await expectCode(
      inTenant(() => ctx.service.replaceFor('file', 'f1', { tagIds: [] }, ACTOR)),
      'AUTHZ_FORBIDDEN',
    );
    expect(ctx.repo.replace).not.toHaveBeenCalled();
  });

  it('沒有登記的資源類型 → TAG_SCOPE_NOT_FOUND', async () => {
    const ctx = setup();
    await expectCode(
      inTenant(() => ctx.service.replaceFor('role', 'r1', { tagIds: [] }, ACTOR)),
      'TAG_SCOPE_NOT_FOUND',
    );
  });
});

describe('TagService.tagsOf（給擁有者的批次讀取，D6）', () => {
  it('每個資源對到自己的標籤；沒有標籤的是空陣列', async () => {
    const ctx = setup();
    const a = tag('a');
    ctx.repo.tagsOf.mockResolvedValue([assigned('f1', a)]);
    const result = await ctx.service.tagsOf('file', ['f1', 'f2']);
    expect(result.get('f1')).toEqual([{ id: 'a', name: '標籤 a', color: 'neutral' }]);
    expect(result.get('f2')).toEqual([]);
  });
});

describe('TagService 其他分支（docs/architecture/backend/18-tag.md §7.2 D3、D9、D11）', () => {
  it('改名：條件式 UPDATE 沒命中、交易內重讀還在 → TAG_VERSION_CONFLICT 帶最新的 version，不寫稽核', async () => {
    const ctx = setup();
    ctx.repo.update.mockResolvedValue(undefined as never);
    ctx.repo.findById
      .mockResolvedValueOnce(tag('t1'))
      .mockResolvedValueOnce(tag('t1', { version: 5 }));
    await expectCode(
      inTenant(() => ctx.service.update('t1', { name: 'x', version: 1 }, ACTOR)),
      'TAG_VERSION_CONFLICT',
      { current: 5 },
    );
    expect(ctx.audit.record).not.toHaveBeenCalled();
    expect(ctx.events.publish).not.toHaveBeenCalled();
  });

  it('改名：條件式 UPDATE 沒命中、交易內重讀已不在 → TAG_NOT_FOUND', async () => {
    const ctx = setup();
    ctx.repo.update.mockResolvedValue(undefined as never);
    ctx.repo.findById.mockResolvedValueOnce(tag('t1')).mockResolvedValueOnce(undefined);
    await expectCode(
      inTenant(() => ctx.service.update('t1', { name: 'x', version: 1 }, ACTOR)),
      'TAG_NOT_FOUND',
    );
  });

  it(`一個資源超過 ${TAG_MAX_PER_RESOURCE} 個標籤 → TAG_LIMIT_REACHED，不寫入`, async () => {
    const ctx = setup();
    const tagIds = Array.from({ length: TAG_MAX_PER_RESOURCE + 1 }, (_, i) => `t${i}`);
    await expectCode(
      inTenant(() => ctx.service.replaceFor('file', 'f1', { tagIds }, ACTOR)),
      'TAG_LIMIT_REACHED',
      { max: TAG_MAX_PER_RESOURCE },
    );
    expect(ctx.repo.replace).not.toHaveBeenCalled();
  });

  it('資源永久刪除時，在擁有者的交易內清掉它們的指派', async () => {
    const ctx = setup();
    await ctx.service.removeAllFor('file', ['f1', 'f2'], ctx.tx as never);
    expect(ctx.repo.removeAllFor).toHaveBeenCalledWith('file', ['f1', 'f2'], ctx.tx);
  });
});
