import { ChangeKind, ChangeSource } from '@b2b-system/realtime';
import { describe, expect, it, vi } from 'vitest';

import type { AuthUser } from '@/common/types';
import type { DbOrTx } from '@/core/database';
import { AppException } from '@/core/errors';
import { DomainEvent } from '@/core/events';
import type { DomainEventBus } from '@/core/events';
import type { FileFolderRow } from '@/db/schema';
import type { AuditService } from '@/modules/audit-log/audit.service';

import type { FileGrantSubjectType } from '../dto/file-folder-grant.dto';
import type { FolderNode } from '../file-access.context';
import type {
  FileFolderGrantRepository,
  FolderGrant,
  FolderGrantWithSubject,
  GrantKey,
} from '../file-folder-grant.repository';
import { FileFolderGrantService } from '../file-folder-grant.service';
import type { FileFolderTree } from '../file-folder-tree';
import type { FileFolderRepository } from '../file-folder.repository';
import type { GrantLevel } from '../file-grant.levels';
import { createFileAccess } from './file-access.fixture';
import type { AccessFixtureOptions } from './file-access.fixture';

const ACTOR: AuthUser = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'actor@x',
  status: 'active',
};
const ROOT = '00000000-0000-4000-8000-00000000000a';
const PARENT = '00000000-0000-4000-8000-00000000000b';
const CHILD = '00000000-0000-4000-8000-00000000000c';
const MISSING = '00000000-0000-4000-8000-0000000000ff';
const ROLE_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ROLE_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const USER_C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const PAST = new Date('2000-01-01T00:00:00Z');
const FUTURE = new Date('2999-01-01T00:00:00Z');
const GRANTED_AT = new Date('2026-09-01T00:00:00Z');

interface SeedGrant {
  folderId: string;
  subjectType: FileGrantSubjectType;
  subjectId: string;
  level: GrantLevel;
  expiresAt?: Date | null;
  name?: string;
}

const keyString = (key: GrantKey) => `${key.folderId}|${key.subjectType}|${key.subjectId}`;

/**
 * ROOT → PARENT → CHILD（都繼承）。授權以記憶體裡的 Map 模擬 repository；
 * 操作者自己的能力由 fixture 的全域權限與資料夾授權決定（真的關係圖模型）。
 */
function setup(access: Omit<AccessFixtureOptions, 'nodes'> = {}, seed: SeedGrant[] = []) {
  const nodes = new Map<string, FolderNode>([
    [ROOT, { id: ROOT, parentId: null, inheritGrants: true, createdBy: null }],
    [PARENT, { id: PARENT, parentId: ROOT, inheritGrants: true, createdBy: null }],
    [CHILD, { id: CHILD, parentId: PARENT, inheritGrants: true, createdBy: null }],
  ]);
  const names: Record<string, string> = { [ROOT]: '根', [PARENT]: '上層', [CHILD]: '子' };
  const store = new Map<string, FolderGrantWithSubject>();
  for (const grant of seed) {
    store.set(keyString(grant), {
      folderId: grant.folderId,
      subjectType: grant.subjectType,
      subjectId: grant.subjectId,
      level: grant.level,
      expiresAt: grant.expiresAt ?? null,
      grantedAt: GRANTED_AT,
      grantedBy: null,
      subjectName: grant.name ?? grant.subjectId,
    });
  }

  const folderRow = (id: string): FileFolderRow | undefined => {
    const node = nodes.get(id);
    if (!node) return undefined;
    return {
      id,
      name: names[id] ?? '',
      parentId: node.parentId,
      inheritGrants: node.inheritGrants,
      kind: 'normal',
      ownerId: null,
      createdAt: GRANTED_AT,
      createdBy: null,
      updatedAt: GRANTED_AT,
      updatedBy: null,
      deletedAt: null,
      deletionId: null,
    };
  };
  const folders = {
    findById: vi.fn(async (id: string, _tx?: DbOrTx) => folderRow(id)),
    findByIds: vi.fn(async (ids: string[]) => ids.flatMap((id) => folderRow(id) ?? [])),
    setInheritGrants: vi.fn(
      async (id: string, values: { inheritGrants: boolean; updatedBy: string }, _tx: DbOrTx) => {
        const node = nodes.get(id);
        if (node) nodes.set(id, { ...node, inheritGrants: values.inheritGrants });
      },
    ),
  };
  const grants = {
    subjectExists: vi.fn(async (_type: FileGrantSubjectType, _id: string, _tx?: DbOrTx) => true),
    find: vi.fn(async (key: GrantKey, _tx?: DbOrTx): Promise<FolderGrant | undefined> =>
      store.get(keyString(key)),
    ),
    set: vi.fn(
      async (
        key: GrantKey,
        values: { level: GrantLevel; expiresAt: Date | null; grantedBy: string | null },
        _tx: DbOrTx,
      ): Promise<FolderGrant> => {
        const row = { ...key, ...values, grantedAt: GRANTED_AT, subjectName: key.subjectId };
        store.set(keyString(key), row);
        return row;
      },
    ),
    delete: vi.fn(async (key: GrantKey, _tx: DbOrTx) => {
      const existing = store.get(keyString(key));
      store.delete(keyString(key));
      return existing;
    }),
    listOn: vi.fn(async (folderIds: readonly string[], _tx?: DbOrTx) =>
      [...store.values()].filter((grant) => folderIds.includes(grant.folderId)),
    ),
    searchSubjects: vi.fn(
      async (_type: FileGrantSubjectType, _keyword: string | undefined, _limit: number) => [
        { id: ROLE_A, name: '業務', hint: 'sales' },
        { id: ROLE_B, name: '財務', hint: null },
      ],
    ),
  };
  const tree = {
    write: vi.fn(async <T>(work: (tx: DbOrTx) => Promise<T>) => work('tx' as unknown as DbOrTx)),
  };
  const audit = {
    record: vi.fn(async (_entry: Record<string, unknown>, _tx?: DbOrTx) => undefined),
  };
  const events = { publish: vi.fn() };
  const fixture = createFileAccess({ ...access, nodes: () => [...nodes.values()] });
  const service = new FileFolderGrantService(
    tree as unknown as FileFolderTree,
    folders as unknown as FileFolderRepository,
    grants as unknown as FileFolderGrantRepository,
    fixture.access,
    audit as unknown as AuditService,
    events as unknown as DomainEventBus,
  );
  return { service, store, nodes, folders, grants, tree, audit, events, denied: fixture.audit };
}

async function errorOf(promise: Promise<unknown>): Promise<AppException | undefined> {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  return error instanceof AppException ? error : undefined;
}

const FOLDER_UPDATED = {
  changes: [{ resource: ChangeSource.FILE_FOLDER, kind: ChangeKind.UPDATE, id: CHILD }],
};

/** 只有全域 file:read ＋ file:share：授予得起 viewer，contributor 以上不行（§6.1 的例子）。 */
const SHARE_ONLY: Omit<AccessFixtureOptions, 'nodes'> = { global: ['read', 'share'] };

describe('FileFolderGrantService.list（docs/rbac/07-resource-grants.md §6）', () => {
  it('資料夾不存在 → FILE_FOLDER_NOT_FOUND', async () => {
    const { service } = setup();
    expect((await errorOf(service.list(MISSING, ACTOR)))?.code).toBe('FILE_FOLDER_NOT_FOUND');
  });

  it('在資料夾沒有 share → AUTHZ_FORBIDDEN，並寫 authz.denied', async () => {
    const { service, denied } = setup({
      global: [],
      grants: [{ resourceId: CHILD, level: 'editor' }],
    });
    const error = await errorOf(service.list(CHILD, ACTOR));
    expect(error?.code).toBe('AUTHZ_FORBIDDEN');
    expect(denied.recordSafely).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'authz.denied',
        metadata: { action: 'share', resourceType: 'fileFolder', resourceId: CHILD },
      }),
    );
  });

  it('資料夾的 manager（沒有全域權限）可以看授權清單', async () => {
    const { service } = setup({ global: [], grants: [{ resourceId: CHILD, level: 'manager' }] });
    expect((await service.list(CHILD, ACTOR)).folderId).toBe(CHILD);
  });

  it('直接授權的 source 是 null；繼承來的標出來源資料夾的 id 與名稱', async () => {
    const { service } = setup({}, [
      { folderId: CHILD, subjectType: 'role', subjectId: ROLE_A, level: 'viewer' },
      { folderId: ROOT, subjectType: 'role', subjectId: ROLE_B, level: 'editor' },
    ]);
    const { items } = await service.list(CHILD, ACTOR);
    expect(items.map((item) => [item.subjectId, item.source])).toEqual([
      [ROLE_A, null],
      [ROLE_B, { folderId: ROOT, folderName: '根' }],
    ]);
  });

  it('排序：離資料夾近的在前，同一層等級高的在前，同等級依名稱', async () => {
    const { service } = setup({}, [
      { folderId: PARENT, subjectType: 'role', subjectId: ROLE_A, level: 'manager', name: 'A' },
      { folderId: CHILD, subjectType: 'role', subjectId: ROLE_B, level: 'viewer', name: 'B' },
      { folderId: CHILD, subjectType: 'user', subjectId: USER_C, level: 'editor', name: 'Z' },
      { folderId: CHILD, subjectType: 'user', subjectId: ACTOR.id, level: 'editor', name: 'M' },
    ]);
    const { items } = await service.list(CHILD, ACTOR);
    expect(items.map((item) => item.subjectName)).toEqual(['M', 'Z', 'B', 'A']);
  });

  it('中斷繼承的資料夾不列出更上層的授權', async () => {
    const { service, nodes } = setup({}, [
      { folderId: ROOT, subjectType: 'role', subjectId: ROLE_A, level: 'editor' },
      { folderId: PARENT, subjectType: 'role', subjectId: ROLE_B, level: 'viewer' },
    ]);
    nodes.set(PARENT, { id: PARENT, parentId: ROOT, inheritGrants: false, createdBy: null });
    const { items } = await service.list(CHILD, ACTOR);
    expect(items.map((item) => item.subjectId)).toEqual([ROLE_B]);
  });

  it('過期的授權仍列出，標 isExpired；未過期與不過期的不標', async () => {
    const { service } = setup({}, [
      { folderId: CHILD, subjectType: 'role', subjectId: ROLE_A, level: 'viewer', expiresAt: PAST },
      {
        folderId: CHILD,
        subjectType: 'role',
        subjectId: ROLE_B,
        level: 'viewer',
        expiresAt: FUTURE,
      },
      { folderId: CHILD, subjectType: 'user', subjectId: USER_C, level: 'viewer' },
    ]);
    const { items } = await service.list(CHILD, ACTOR);
    expect(
      Object.fromEntries(items.map((item) => [item.subjectId, [item.isExpired, item.expiresAt]])),
    ).toEqual({
      [ROLE_A]: [true, PAST.toISOString()],
      [ROLE_B]: [false, FUTURE.toISOString()],
      [USER_C]: [false, null],
    });
  });

  it('assignableLevels 只列出操作者授予得起的等級', async () => {
    const { service } = setup(SHARE_ONLY);
    expect((await service.list(CHILD, ACTOR)).assignableLevels).toEqual(['viewer']);
  });

  it('全域權限齊全時四個等級都授予得起', async () => {
    const { service } = setup();
    expect((await service.list(CHILD, ACTOR)).assignableLevels).toEqual([
      'viewer',
      'contributor',
      'editor',
      'manager',
    ]);
  });
});

describe('FileFolderGrantService.set（docs/rbac/07-resource-grants.md §6.1、§6.4）', () => {
  it('對象不存在 → FILE_GRANT_SUBJECT_NOT_FOUND，不寫入', async () => {
    const { service, grants, events } = setup();
    grants.subjectExists.mockResolvedValueOnce(false);
    const error = await errorOf(
      service.set(
        CHILD,
        { subjectType: 'role', subjectId: ROLE_A, level: 'viewer', expiresAt: null },
        ACTOR,
      ),
    );
    expect(error?.code).toBe('FILE_GRANT_SUBJECT_NOT_FOUND');
    expect(error?.details).toEqual({ subjectType: 'role', subjectId: ROLE_A });
    expect(grants.set).not.toHaveBeenCalled();
    expect(events.publish).not.toHaveBeenCalled();
  });

  it('資料夾不存在 → FILE_FOLDER_NOT_FOUND', async () => {
    const { service } = setup();
    const error = await errorOf(
      service.set(
        MISSING,
        { subjectType: 'role', subjectId: ROLE_A, level: 'viewer', expiresAt: null },
        ACTOR,
      ),
    );
    expect(error?.code).toBe('FILE_FOLDER_NOT_FOUND');
  });

  it('沒有 share → AUTHZ_FORBIDDEN，不寫入', async () => {
    const { service, grants } = setup({ global: ['read', 'create', 'update', 'delete'] });
    const error = await errorOf(
      service.set(
        CHILD,
        { subjectType: 'role', subjectId: ROLE_A, level: 'viewer', expiresAt: null },
        ACTOR,
      ),
    );
    expect(error?.code).toBe('AUTHZ_FORBIDDEN');
    expect(grants.set).not.toHaveBeenCalled();
  });

  it('授予比自己高的等級 → AUTHZ_ESCALATION，details.missing 列出缺的權限鍵', async () => {
    const { service, grants, audit, events } = setup(SHARE_ONLY);
    const error = await errorOf(
      service.set(
        CHILD,
        { subjectType: 'role', subjectId: ROLE_A, level: 'editor', expiresAt: null },
        ACTOR,
      ),
    );
    expect(error?.code).toBe('AUTHZ_ESCALATION');
    expect(error?.details).toEqual({ missing: ['file:create', 'file:update', 'file:delete'] });
    expect(grants.set).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
    expect(events.publish).not.toHaveBeenCalled();
  });

  it('把比自己高的既有授權降級 → AUTHZ_ESCALATION（要管得了原本的等級）', async () => {
    const { service, store } = setup(SHARE_ONLY, [
      { folderId: CHILD, subjectType: 'role', subjectId: ROLE_A, level: 'manager' },
    ]);
    const error = await errorOf(
      service.set(
        CHILD,
        { subjectType: 'role', subjectId: ROLE_A, level: 'viewer', expiresAt: null },
        ACTOR,
      ),
    );
    expect(error?.code).toBe('AUTHZ_ESCALATION');
    expect(store.get(`${CHILD}|role|${ROLE_A}`)?.level).toBe('manager');
  });

  it('資料夾等級帶來的能力也算：資料夾 manager 可以授予 manager', async () => {
    const { service, store } = setup({
      global: [],
      grants: [{ resourceId: PARENT, level: 'manager' }],
    });
    await service.set(
      CHILD,
      { subjectType: 'user', subjectId: USER_C, level: 'manager', expiresAt: null },
      ACTOR,
    );
    expect(store.get(`${CHILD}|user|${USER_C}`)?.level).toBe('manager');
  });

  it('授予得起：在樹鎖的交易內寫入等級、到期時間、授予者', async () => {
    const { service, grants, tree } = setup(SHARE_ONLY);
    await service.set(
      CHILD,
      {
        subjectType: 'role',
        subjectId: ROLE_A,
        level: 'viewer',
        expiresAt: FUTURE.toISOString(),
      },
      ACTOR,
    );
    expect(tree.write).toHaveBeenCalledTimes(1);
    expect(grants.set).toHaveBeenCalledWith(
      { folderId: CHILD, subjectType: 'role', subjectId: ROLE_A },
      { level: 'viewer', expiresAt: FUTURE, grantedBy: ACTOR.id },
      'tx',
    );
  });

  it('expiresAt 為 null → 不過期', async () => {
    const { service, grants } = setup();
    await service.set(
      CHILD,
      { subjectType: 'role', subjectId: ROLE_A, level: 'editor', expiresAt: null },
      ACTOR,
    );
    expect(grants.set).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ expiresAt: null }),
      'tx',
    );
  });

  it('新增的稽核：fileFolder.grant，before 是 null、after 是授權快照（同一個交易）', async () => {
    const { service, audit } = setup();
    await service.set(
      CHILD,
      { subjectType: 'role', subjectId: ROLE_A, level: 'editor', expiresAt: null },
      ACTOR,
    );
    expect(audit.record).toHaveBeenCalledWith(
      {
        action: 'fileFolder.grant',
        resourceType: 'fileFolder',
        resourceId: CHILD,
        resourceName: '子',
        changes: {
          before: null,
          after: { subjectType: 'role', subjectId: ROLE_A, level: 'editor', expiresAt: null },
        },
      },
      'tx',
    );
  });

  it('變更既有授權：稽核的 before 是原本的等級與到期時間', async () => {
    const { service, audit } = setup({}, [
      {
        folderId: CHILD,
        subjectType: 'role',
        subjectId: ROLE_A,
        level: 'viewer',
        expiresAt: FUTURE,
      },
    ]);
    await service.set(
      CHILD,
      { subjectType: 'role', subjectId: ROLE_A, level: 'editor', expiresAt: null },
      ACTOR,
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        changes: expect.objectContaining({
          before: {
            subjectType: 'role',
            subjectId: ROLE_A,
            level: 'viewer',
            expiresAt: FUTURE.toISOString(),
          },
        }),
      }),
      'tx',
    );
  });

  it('交易完成後才推 fileFolder update', async () => {
    const { service, audit, tree, events } = setup();
    await service.set(
      CHILD,
      { subjectType: 'role', subjectId: ROLE_A, level: 'viewer', expiresAt: null },
      ACTOR,
    );
    expect(events.publish).toHaveBeenCalledWith(DomainEvent.RESOURCE_CHANGED, FOLDER_UPDATED);
    const publishOrder = events.publish.mock.invocationCallOrder[0] ?? 0;
    expect(publishOrder).toBeGreaterThan(audit.record.mock.invocationCallOrder[0] ?? Infinity);
    expect(publishOrder).toBeGreaterThan(tree.write.mock.invocationCallOrder[0] ?? Infinity);
  });

  it('交易失敗（例：稽核寫入失敗）→ 不推播', async () => {
    const { service, audit, events } = setup();
    audit.record.mockRejectedValueOnce(new Error('db down'));
    await expect(
      service.set(
        CHILD,
        { subjectType: 'role', subjectId: ROLE_A, level: 'viewer', expiresAt: null },
        ACTOR,
      ),
    ).rejects.toThrow('db down');
    expect(events.publish).not.toHaveBeenCalled();
  });

  it('回傳寫入後的授權清單', async () => {
    const { service } = setup();
    const result = await service.set(
      CHILD,
      { subjectType: 'role', subjectId: ROLE_A, level: 'contributor', expiresAt: null },
      ACTOR,
    );
    expect(result.items).toEqual([
      expect.objectContaining({ subjectId: ROLE_A, level: 'contributor', source: null }),
    ]);
  });
});

describe('FileFolderGrantService.revoke（docs/rbac/07-resource-grants.md §6.1、§6.4）', () => {
  it('授權不存在 → FILE_GRANT_NOT_FOUND', async () => {
    const { service, grants } = setup();
    const error = await errorOf(service.revoke(CHILD, 'role', ROLE_A, ACTOR));
    expect(error?.code).toBe('FILE_GRANT_NOT_FOUND');
    expect(error?.details).toEqual({ subjectType: 'role', subjectId: ROLE_A });
    expect(grants.delete).not.toHaveBeenCalled();
  });

  it('繼承來的授權不能在子資料夾移除 → FILE_GRANT_NOT_FOUND', async () => {
    const { service } = setup({}, [
      { folderId: PARENT, subjectType: 'role', subjectId: ROLE_A, level: 'viewer' },
    ]);
    expect((await errorOf(service.revoke(CHILD, 'role', ROLE_A, ACTOR)))?.code).toBe(
      'FILE_GRANT_NOT_FOUND',
    );
  });

  it('移除比自己高的授權 → AUTHZ_ESCALATION，不刪除', async () => {
    const { service, grants } = setup(SHARE_ONLY, [
      { folderId: CHILD, subjectType: 'role', subjectId: ROLE_A, level: 'contributor' },
    ]);
    const error = await errorOf(service.revoke(CHILD, 'role', ROLE_A, ACTOR));
    expect(error?.code).toBe('AUTHZ_ESCALATION');
    expect(error?.details).toEqual({ missing: ['file:create'] });
    expect(grants.delete).not.toHaveBeenCalled();
  });

  it('沒有 share → AUTHZ_FORBIDDEN', async () => {
    const { service } = setup({ global: ['read'] }, [
      { folderId: CHILD, subjectType: 'role', subjectId: ROLE_A, level: 'viewer' },
    ]);
    expect((await errorOf(service.revoke(CHILD, 'role', ROLE_A, ACTOR)))?.code).toBe(
      'AUTHZ_FORBIDDEN',
    );
  });

  it('移除得起：刪除並寫 fileFolder.revoke 稽核（before 是原本的授權），交易後推播', async () => {
    const { service, store, audit, events } = setup(SHARE_ONLY, [
      { folderId: CHILD, subjectType: 'role', subjectId: ROLE_A, level: 'viewer' },
    ]);
    await service.revoke(CHILD, 'role', ROLE_A, ACTOR);
    expect(store.has(`${CHILD}|role|${ROLE_A}`)).toBe(false);
    expect(audit.record).toHaveBeenCalledWith(
      {
        action: 'fileFolder.revoke',
        resourceType: 'fileFolder',
        resourceId: CHILD,
        resourceName: '子',
        changes: {
          before: { subjectType: 'role', subjectId: ROLE_A, level: 'viewer', expiresAt: null },
        },
      },
      'tx',
    );
    expect(events.publish).toHaveBeenCalledWith(DomainEvent.RESOURCE_CHANGED, FOLDER_UPDATED);
  });
});

describe('FileFolderGrantService.setInheritance（docs/rbac/07-resource-grants.md §3.3）', () => {
  it('與目前狀態相同 → 不寫入、不寫稽核', async () => {
    const { service, folders, audit, grants } = setup();
    await service.setInheritance(CHILD, { inheritGrants: true }, ACTOR);
    expect(folders.setInheritGrants).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
    expect(grants.set).not.toHaveBeenCalled();
  });

  it('沒有 share → AUTHZ_FORBIDDEN，不中斷', async () => {
    const { service, folders } = setup({ global: ['read'] });
    expect(
      (await errorOf(service.setInheritance(CHILD, { inheritGrants: false }, ACTOR)))?.code,
    ).toBe('AUTHZ_FORBIDDEN');
    expect(folders.setInheritGrants).not.toHaveBeenCalled();
  });

  it('中斷：繼承到的授權複製成直接授權，授予者是操作者、保留到期時間', async () => {
    const { service, store } = setup({}, [
      {
        folderId: PARENT,
        subjectType: 'role',
        subjectId: ROLE_A,
        level: 'editor',
        expiresAt: FUTURE,
      },
    ]);
    await service.setInheritance(CHILD, { inheritGrants: false }, ACTOR);
    expect(store.get(`${CHILD}|role|${ROLE_A}`)).toEqual(
      expect.objectContaining({ level: 'editor', expiresAt: FUTURE, grantedBy: ACTOR.id }),
    );
  });

  it('同一個對象在上層鏈有多筆：取最高的等級', async () => {
    const { service, store } = setup({}, [
      { folderId: ROOT, subjectType: 'role', subjectId: ROLE_A, level: 'manager' },
      { folderId: PARENT, subjectType: 'role', subjectId: ROLE_A, level: 'viewer' },
    ]);
    await service.setInheritance(CHILD, { inheritGrants: false }, ACTOR);
    expect(store.get(`${CHILD}|role|${ROLE_A}`)?.level).toBe('manager');
  });

  it('已過期的繼承授權不複製', async () => {
    const { service, store } = setup({}, [
      {
        folderId: PARENT,
        subjectType: 'role',
        subjectId: ROLE_A,
        level: 'editor',
        expiresAt: PAST,
      },
    ]);
    await service.setInheritance(CHILD, { inheritGrants: false }, ACTOR);
    expect(store.has(`${CHILD}|role|${ROLE_A}`)).toBe(false);
  });

  it('自己已有同等或更高的直接授權：不覆寫', async () => {
    const { service, grants } = setup({}, [
      { folderId: PARENT, subjectType: 'role', subjectId: ROLE_A, level: 'editor' },
      { folderId: CHILD, subjectType: 'role', subjectId: ROLE_A, level: 'manager' },
    ]);
    await service.setInheritance(CHILD, { inheritGrants: false }, ACTOR);
    expect(grants.set).not.toHaveBeenCalled();
  });

  it('自己的直接授權較低：覆寫成繼承來的較高等級', async () => {
    const { service, store } = setup({}, [
      { folderId: PARENT, subjectType: 'role', subjectId: ROLE_A, level: 'editor' },
      { folderId: CHILD, subjectType: 'role', subjectId: ROLE_A, level: 'viewer' },
    ]);
    await service.setInheritance(CHILD, { inheritGrants: false }, ACTOR);
    expect(store.get(`${CHILD}|role|${ROLE_A}`)?.level).toBe('editor');
  });

  it('自己的直接授權已過期：視為沒有，覆寫成繼承來的有效授權', async () => {
    const { service, store } = setup({}, [
      { folderId: PARENT, subjectType: 'role', subjectId: ROLE_A, level: 'editor' },
      {
        folderId: CHILD,
        subjectType: 'role',
        subjectId: ROLE_A,
        level: 'manager',
        expiresAt: PAST,
      },
    ]);
    await service.setInheritance(CHILD, { inheritGrants: false }, ACTOR);
    const copied = store.get(`${CHILD}|role|${ROLE_A}`);
    expect(copied?.level).toBe('editor');
    expect(copied?.expiresAt ?? null).toBeNull();
  });

  it('上層鏈只走到第一個中斷繼承的資料夾（含）', async () => {
    const { service, store, nodes } = setup({}, [
      { folderId: ROOT, subjectType: 'role', subjectId: ROLE_A, level: 'viewer' },
      { folderId: PARENT, subjectType: 'role', subjectId: ROLE_B, level: 'viewer' },
    ]);
    nodes.set(PARENT, { id: PARENT, parentId: ROOT, inheritGrants: false, createdBy: null });
    await service.setInheritance(CHILD, { inheritGrants: false }, ACTOR);
    expect(store.has(`${CHILD}|role|${ROLE_B}`)).toBe(true);
    expect(store.has(`${CHILD}|role|${ROLE_A}`)).toBe(false);
  });

  it('複製不受反提權限制：只授予得起 viewer 的人中斷時仍複製上層的 manager', async () => {
    const { service, store } = setup(SHARE_ONLY, [
      { folderId: ROOT, subjectType: 'role', subjectId: ROLE_A, level: 'manager' },
    ]);
    await service.setInheritance(CHILD, { inheritGrants: false }, ACTOR);
    expect(store.get(`${CHILD}|role|${ROLE_A}`)?.level).toBe('manager');
  });

  it('中斷的稽核：fileFolder.inheritance，after.copied 列出複製的授權', async () => {
    const { service, audit } = setup({}, [
      { folderId: PARENT, subjectType: 'role', subjectId: ROLE_A, level: 'viewer' },
    ]);
    await service.setInheritance(CHILD, { inheritGrants: false }, ACTOR);
    expect(audit.record).toHaveBeenCalledWith(
      {
        action: 'fileFolder.inheritance',
        resourceType: 'fileFolder',
        resourceId: CHILD,
        resourceName: '子',
        changes: {
          before: { inheritGrants: true },
          after: {
            inheritGrants: false,
            copied: [{ subjectType: 'role', subjectId: ROLE_A, level: 'viewer', expiresAt: null }],
          },
        },
      },
      'tx',
    );
  });

  it('中斷後回傳的清單：inheritGrants=false，只剩直接授權', async () => {
    const { service } = setup({}, [
      { folderId: PARENT, subjectType: 'role', subjectId: ROLE_A, level: 'viewer' },
    ]);
    const result = await service.setInheritance(CHILD, { inheritGrants: false }, ACTOR);
    expect(result.inheritGrants).toBe(false);
    expect(result.items.map((item) => [item.subjectId, item.source])).toEqual([[ROLE_A, null]]);
  });

  it('恢復繼承：不複製也不刪除直接授權，寫入 inheritGrants=true', async () => {
    const { service, nodes, folders, grants } = setup({}, [
      { folderId: ROOT, subjectType: 'role', subjectId: ROLE_A, level: 'viewer' },
    ]);
    nodes.set(CHILD, { id: CHILD, parentId: PARENT, inheritGrants: false, createdBy: null });
    await service.setInheritance(CHILD, { inheritGrants: true }, ACTOR);
    expect(grants.set).not.toHaveBeenCalled();
    expect(grants.delete).not.toHaveBeenCalled();
    expect(folders.setInheritGrants).toHaveBeenCalledWith(
      CHILD,
      { inheritGrants: true, updatedBy: ACTOR.id },
      'tx',
    );
  });
});

describe('FileFolderGrantService.searchSubjects（docs/rbac/07-resource-grants.md §6.2）', () => {
  it('沒有 share → AUTHZ_FORBIDDEN，不查詢', async () => {
    const { service, grants } = setup({ global: ['read'] });
    const error = await errorOf(service.searchSubjects(CHILD, { subjectType: 'role' }, ACTOR));
    expect(error?.code).toBe('AUTHZ_FORBIDDEN');
    expect(grants.searchSubjects).not.toHaveBeenCalled();
  });

  it('一次最多 20 筆，只回 id、名稱、提示並帶上對象類型', async () => {
    const { service, grants } = setup();
    const result = await service.searchSubjects(
      CHILD,
      { subjectType: 'role', keyword: '業' },
      ACTOR,
    );
    expect(grants.searchSubjects).toHaveBeenCalledWith('role', '業', 20);
    expect(result.items).toEqual([
      { subjectType: 'role', id: ROLE_A, name: '業務', hint: 'sales' },
      { subjectType: 'role', id: ROLE_B, name: '財務', hint: null },
    ]);
  });
});
