import { describe, expect, it, vi } from 'vitest';

import type { AuthUser } from '@/common/types';
import { AppException } from '@/core/errors';
import type { DomainEventBus } from '@/core/events';
import type { OrgUnitRow } from '@/db/schema';
import type { AuditService } from '@/modules/audit-log/audit.service';

import type { OrgUnitRepository } from '../org-unit.repository';
import { OrgUnitService } from '../org-unit.service';
import { ORG_UNIT_MAX_DEPTH } from '../organization.constants';

const ACTOR: AuthUser = { id: 'actor-1', email: 'actor@example.com', status: 'active' };
const UNIT_ID = '11111111-1111-4111-8111-111111111111';
const PARENT_ID = '22222222-2222-4222-8222-222222222222';
const CHILD_ID = '33333333-3333-4333-8333-333333333333';

function unit(overrides: Partial<OrgUnitRow> = {}): OrgUnitRow {
  return {
    id: UNIT_ID,
    parentId: null,
    name: '業務部',
    code: null,
    description: null,
    sortOrder: 0,
    version: 3,
    createdAt: new Date('2026-10-01T00:00:00.000Z'),
    createdBy: null,
    updatedAt: new Date('2026-10-01T00:00:00.000Z'),
    updatedBy: null,
    deletedAt: null,
    ...overrides,
  };
}

function setup() {
  const tx = { name: 'tx' };
  const db = { transaction: vi.fn((fn: (t: unknown) => unknown) => fn(tx)) };
  const repo = {
    findById: vi.fn(async (): Promise<OrgUnitRow | undefined> => unit()),
    withCounts: vi.fn(async () => ({ ...unit(), memberCount: 0, managerCount: 0, managers: [] })),
    pathsOf: vi.fn(async () => new Map()),
    findByCode: vi.fn(async (): Promise<OrgUnitRow | undefined> => undefined),
    findSiblingByName: vi.fn(async (): Promise<OrgUnitRow | undefined> => undefined),
    lockStructure: vi.fn(async () => undefined),
    lockActiveRow: vi.fn(async (): Promise<OrgUnitRow | undefined> => unit()),
    ancestors: vi.fn(async (): Promise<Array<{ id: string }>> => []),
    descendants: vi.fn(async () => [{ id: UNIT_ID, depth: 0 }]),
    nextSortOrder: vi.fn(async () => 0),
    create: vi.fn(async () => unit()),
    update: vi.fn(async (): Promise<OrgUnitRow | undefined> => unit({ version: 4 })),
    findVersion: vi.fn(async (): Promise<number | undefined> => 5),
    listSiblings: vi.fn(async () => []),
    setSortOrders: vi.fn(async () => undefined),
    hasActiveChildren: vi.fn(async () => false),
    softDelete: vi.fn(async () => undefined),
    memberUserIds: vi.fn(async () => []),
    findDeletedById: vi.fn(async (): Promise<OrgUnitRow | undefined> => undefined),
    exists: vi.fn(async () => true),
    restore: vi.fn(async (): Promise<OrgUnitRow | undefined> => unit()),
    findActiveUserIds: vi.fn(async (ids: readonly string[]) => [...ids]),
    memberSnapshot: vi.fn(async () => []),
    removeMembers: vi.fn(async () => undefined),
    clearPrimaryElsewhere: vi.fn(async () => undefined),
    upsertMembers: vi.fn(async () => undefined),
  };
  const audit = { record: vi.fn(async () => undefined) };
  const events = { publish: vi.fn() };
  const service = new OrgUnitService(
    db as never,
    repo as unknown as OrgUnitRepository,
    audit as unknown as AuditService,
    events as unknown as DomainEventBus,
  );
  return { service, repo, audit, events, tx };
}

async function expectCode(operation: Promise<unknown>, code: string) {
  await expect(operation).rejects.toBeInstanceOf(AppException);
  await expect(operation).rejects.toMatchObject({ code });
}

describe('OrgUnitService.create（docs/architecture/backend/23-organization.md §2）', () => {
  it('成功：在結構的鎖之內建立，稽核 orgUnit.create，推播 orgUnit create', async () => {
    const ctx = setup();
    await ctx.service.create({ name: '業務部' }, ACTOR);
    expect(ctx.repo.lockStructure).toHaveBeenCalledWith(ctx.tx);
    expect(ctx.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'orgUnit.create', resourceType: 'orgUnit' }),
      ctx.tx,
    );
    expect(ctx.events.publish).toHaveBeenCalledWith('resource.changed', {
      changes: [{ resource: 'orgUnit', kind: 'create', id: UNIT_ID }],
      affectedUserIds: [],
    });
  });

  it('上層不存在 → ORG_UNIT_NOT_FOUND', async () => {
    const ctx = setup();
    ctx.repo.findById.mockResolvedValueOnce(undefined);
    await expectCode(
      ctx.service.create({ name: 'x', parentId: PARENT_ID }, ACTOR),
      'ORG_UNIT_NOT_FOUND',
    );
  });

  it('超過層數上限 → ORG_UNIT_TOO_DEEP', async () => {
    const ctx = setup();
    ctx.repo.ancestors.mockResolvedValue(
      Array.from({ length: ORG_UNIT_MAX_DEPTH - 1 }, (_, i) => ({ id: `a${i}` })),
    );
    await expectCode(
      ctx.service.create({ name: 'x', parentId: PARENT_ID }, ACTOR),
      'ORG_UNIT_TOO_DEEP',
    );
  });

  it('同層同名 → ORG_UNIT_NAME_DUPLICATE；代碼重複 → ORG_UNIT_CODE_DUPLICATE', async () => {
    const ctx = setup();
    ctx.repo.findSiblingByName.mockResolvedValueOnce(unit());
    await expectCode(ctx.service.create({ name: '業務部' }, ACTOR), 'ORG_UNIT_NAME_DUPLICATE');
    ctx.repo.findByCode.mockResolvedValueOnce(unit());
    await expectCode(
      ctx.service.create({ name: 'y', code: 'SALES' }, ACTOR),
      'ORG_UNIT_CODE_DUPLICATE',
    );
  });
});

describe('OrgUnitService.update／move', () => {
  it('版本不符 → ORG_UNIT_VERSION_CONFLICT', async () => {
    const ctx = setup();
    await expectCode(
      ctx.service.update(UNIT_ID, { name: 'x', version: 1 }, ACTOR),
      'ORG_UNIT_VERSION_CONFLICT',
    );
    await expectCode(
      ctx.service.move(UNIT_ID, { parentId: null, version: 1 }, ACTOR),
      'ORG_UNIT_VERSION_CONFLICT',
    );
  });

  it('條件式 UPDATE 沒命中（交易中被改）→ ORG_UNIT_VERSION_CONFLICT', async () => {
    const ctx = setup();
    ctx.repo.update.mockResolvedValueOnce(undefined);
    await expectCode(
      ctx.service.update(UNIT_ID, { name: 'x', version: 3 }, ACTOR),
      'ORG_UNIT_VERSION_CONFLICT',
    );
  });

  it('搬到自己或自己的下層 → ORG_UNIT_CYCLE', async () => {
    const ctx = setup();
    await expectCode(
      ctx.service.move(UNIT_ID, { parentId: UNIT_ID, version: 3 }, ACTOR),
      'ORG_UNIT_CYCLE',
    );
    ctx.repo.descendants.mockResolvedValue([
      { id: UNIT_ID, depth: 0 },
      { id: CHILD_ID, depth: 1 },
    ]);
    await expectCode(
      ctx.service.move(UNIT_ID, { parentId: CHILD_ID, version: 3 }, ACTOR),
      'ORG_UNIT_CYCLE',
    );
  });

  it('子樹放不下 → ORG_UNIT_TOO_DEEP', async () => {
    const ctx = setup();
    ctx.repo.descendants.mockResolvedValue([
      { id: UNIT_ID, depth: 0 },
      { id: CHILD_ID, depth: 2 },
    ]);
    ctx.repo.ancestors.mockResolvedValue(
      Array.from({ length: ORG_UNIT_MAX_DEPTH - 3 }, (_, i) => ({ id: `a${i}` })),
    );
    await expectCode(
      ctx.service.move(UNIT_ID, { parentId: PARENT_ID, version: 3 }, ACTOR),
      'ORG_UNIT_TOO_DEEP',
    );
  });

  it('搬移後依 beforeId 重排同層，稽核 before／after 的上層', async () => {
    const ctx = setup();
    ctx.repo.listSiblings.mockResolvedValue([unit({ id: 'a' }), unit({ id: 'b' })] as never);
    await ctx.service.move(UNIT_ID, { parentId: PARENT_ID, beforeId: 'b', version: 3 }, ACTOR);
    expect(ctx.repo.setSortOrders).toHaveBeenCalledWith(['a', UNIT_ID, 'b'], ctx.tx);
    expect(ctx.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'orgUnit.move',
        changes: { before: { parentId: null }, after: { parentId: PARENT_ID } },
      }),
      ctx.tx,
    );
  });
});

describe('OrgUnitService.remove／restore', () => {
  it('還有下層 → ORG_UNIT_HAS_CHILDREN，不刪除', async () => {
    const ctx = setup();
    ctx.repo.hasActiveChildren.mockResolvedValueOnce(true);
    await expectCode(ctx.service.remove(UNIT_ID, ACTOR), 'ORG_UNIT_HAS_CHILDREN');
    expect(ctx.repo.softDelete).not.toHaveBeenCalled();
  });

  it('沒有被刪除 → ORG_UNIT_NOT_DELETED；不存在 → ORG_UNIT_NOT_FOUND', async () => {
    const ctx = setup();
    await expectCode(ctx.service.restore(UNIT_ID, ACTOR), 'ORG_UNIT_NOT_DELETED');
    ctx.repo.exists.mockResolvedValueOnce(false);
    await expectCode(ctx.service.restore(UNIT_ID, ACTOR), 'ORG_UNIT_NOT_FOUND');
  });

  it('上層已刪除 → ORG_UNIT_PARENT_DELETED', async () => {
    const ctx = setup();
    ctx.repo.findDeletedById.mockResolvedValue(
      unit({ parentId: PARENT_ID, deletedAt: new Date() }),
    );
    ctx.repo.findById.mockResolvedValueOnce(undefined);
    await expectCode(ctx.service.restore(UNIT_ID, ACTOR), 'ORG_UNIT_PARENT_DELETED');
  });
});

describe('OrgUnitService.updateMembers（D6）', () => {
  it('改到自己 → AUTHZ_SELF_MODIFY', async () => {
    const ctx = setup();
    await expectCode(
      ctx.service.updateMembers(
        UNIT_ID,
        { add: [{ userId: ACTOR.id }], update: [], remove: [] },
        ACTOR,
      ),
      'AUTHZ_SELF_MODIFY',
    );
    await expectCode(
      ctx.service.updateMembers(UNIT_ID, { add: [], update: [], remove: [ACTOR.id] }, ACTOR),
      'AUTHZ_SELF_MODIFY',
    );
  });

  it('使用者不存在 → USER_NOT_FOUND', async () => {
    const ctx = setup();
    ctx.repo.findActiveUserIds.mockResolvedValueOnce([]);
    await expectCode(
      ctx.service.updateMembers(
        UNIT_ID,
        { add: [{ userId: 'u1' }], update: [], remove: [] },
        ACTOR,
      ),
      'USER_NOT_FOUND',
    );
  });

  it('設為主要部門時先取消那個人在其他部門的主要部門；推播給被異動的人', async () => {
    const ctx = setup();
    await ctx.service.updateMembers(
      UNIT_ID,
      { add: [{ userId: 'u1', isPrimary: true }, { userId: 'u2' }], update: [], remove: ['u3'] },
      ACTOR,
    );
    expect(ctx.repo.clearPrimaryElsewhere).toHaveBeenCalledWith(UNIT_ID, ['u1'], ctx.tx);
    expect(ctx.repo.clearPrimaryElsewhere.mock.invocationCallOrder[0]).toBeLessThan(
      ctx.repo.upsertMembers.mock.invocationCallOrder[0]!,
    );
    expect(ctx.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'orgUnit.member.add' }),
      ctx.tx,
    );
    expect(ctx.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'orgUnit.member.remove' }),
      ctx.tx,
    );
    expect(ctx.events.publish).toHaveBeenCalledWith(
      'resource.changed',
      expect.objectContaining({ affectedUserIds: ['u1', 'u2', 'u3'] }),
    );
  });
});
