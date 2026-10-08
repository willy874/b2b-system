import { ChangeKind, ChangeSource } from '@b2b-system/realtime';
import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';

import type { PermissionKey } from '@/common/types';
import type { PermissionSet } from '@/core/cache/permission-cache.service';
import type { Env } from '@/core/config';
import type { DbOrTx } from '@/core/database';
import { DomainEvent } from '@/core/events';
import type { DomainEventBus, DomainEventPayloads } from '@/core/events';
import type { Tenancy } from '@/core/tenant';
import type { FileFolderInsert, FileFolderKind, FileFolderRow } from '@/db/schema';
import type { AuditService } from '@/modules/audit-log/audit.service';
import type { PermissionService } from '@/modules/permission/permission.service';

import { FileFolderNameSchema } from '../dto/file-folder.dto';
import type { FileFolderGrantRepository, GrantKey } from '../file-folder-grant.repository';
import type { FileFolderTree } from '../file-folder-tree';
import type { DeletionStamp, FileFolderRepository } from '../file-folder.repository';
import { EVERYONE_SUBJECT_ID } from '../file-grant.levels';
import type { GrantLevel } from '../file-grant.levels';
import {
  FileSystemFolderService,
  personalFolderName,
  PRIVATE_ROOT_FOLDER_NAME,
  SHARED_FOLDER_NAME,
} from '../file-system-folder.service';

const ALICE = {
  id: '11111111-1111-4111-8111-111111111111',
  displayName: 'Alice',
  email: 'alice@example.com',
};

describe('personalFolderName（個人資料夾的候選名稱）', () => {
  it.each([
    [0, 'Alice'],
    [1, 'Alice (alice@example.com)'],
    [2, 'Alice (alice@example.com) 2'],
    [7, 'Alice (alice@example.com) 7'],
    [21, `Alice (${ALICE.id})`],
  ])('第 %i 個候選 → %s', (attempt, expected) => {
    expect(personalFolderName(ALICE, attempt)).toBe(expected);
  });

  it.each([
    ['a/b\\c', 'a b c'],
    ['..', 'alice@example.com'],
    ['  \u0007 ', 'alice@example.com'],
    // 雙向文字控制、C1、零寬字元同樣不允許（docs/architecture/backend/09-file.md §4.2）
    ['Eve\u202egnp.exe', 'Eve gnp.exe'],
    ['a\u0085b\u200bc', 'a b c'],
    ['x'.repeat(300), 'x'.repeat(255)],
  ])('顯示名稱 %j 清理成合法的資料夾名稱 %j', (displayName, expected) => {
    const name = personalFolderName({ ...ALICE, displayName }, 0);
    expect(name).toBe(expected);
    expect(FileFolderNameSchema.safeParse(name).success).toBe(true);
  });

  it('加上後綴後仍不超過 255 字，且後綴完整保留', () => {
    const name = personalFolderName({ ...ALICE, displayName: 'y'.repeat(300) }, 3);
    expect(name).toHaveLength(255);
    expect(name.endsWith(' (alice@example.com) 3')).toBe(true);
    expect(FileFolderNameSchema.safeParse(name).success).toBe(true);
  });
});

const BOB = {
  id: '22222222-2222-4222-8222-222222222222',
  displayName: 'Bob',
  email: 'bob@example.com',
};
const CAROL = {
  id: '33333333-3333-4333-8333-333333333333',
  displayName: 'Carol',
  email: 'carol@example.com',
};
const PEOPLE = [ALICE, BOB, CAROL];

type Handler = (payload: never) => unknown;

interface SystemSetupOptions {
  /** `APP_ROLES`（預設單體）。 */
  appRoles?: string;
  /** 一開始就有的資料夾。 */
  folders?: Partial<FileFolderRow>[];
  /** 每個人的權限：預設 Alice、Bob 有 file:access，Carol 沒有。 */
  permissions?: Record<string, { keys: PermissionKey[]; isSuperAdmin?: boolean }>;
  /** 被刪除的使用者。 */
  deletedOwners?: string[];
}

let folderSequence = 0;

/** 以記憶體裡的資料夾表模擬 repository；結構寫入的交易用假的 tx（savepoint 直接執行）。 */
function systemSetup(options: SystemSetupOptions = {}) {
  const now = new Date('2026-10-01T00:00:00Z');
  const rows = new Map<string, FileFolderRow>();
  const insert = (values: Partial<FileFolderRow> & { name: string }): FileFolderRow => {
    folderSequence += 1;
    const row: FileFolderRow = {
      id: `00000000-0000-4000-9000-${String(folderSequence).padStart(12, '0')}`,
      parentId: null,
      inheritGrants: true,
      kind: 'normal',
      ownerId: null,
      createdAt: now,
      createdBy: null,
      updatedAt: now,
      updatedBy: null,
      deletedAt: null,
      deletionId: null,
      ...values,
    };
    rows.set(row.id, row);
    return row;
  };
  for (const folder of options.folders ?? []) insert({ name: 'x', ...folder });
  const live = () => [...rows.values()].filter((row) => !row.deletedAt);
  const deletedOwners = new Set(options.deletedOwners ?? []);
  /** 裡面有東西的資料夾。 */
  const nonEmpty = new Set<string>();

  const repo = {
    findSingleton: vi.fn(async (kind: FileFolderKind, _tx?: DbOrTx) =>
      live().find((row) => row.kind === kind),
    ),
    findChildren: vi.fn(async (parentIds: (string | null)[], _tx?: DbOrTx) =>
      live().filter((row) => parentIds.includes(row.parentId)),
    ),
    setKind: vi.fn(async (id: string, kind: FileFolderKind, _tx?: DbOrTx) => {
      const row = rows.get(id);
      if (row) row.kind = kind;
    }),
    create: vi.fn(async (values: FileFolderInsert[], _tx?: DbOrTx) =>
      values.map((value) => insert({ ...value, parentId: value.parentId ?? null })),
    ),
    /** 唯一索引的模擬：同層同名（不分大小寫）或擁有者已有個人資料夾的列略過。 */
    createSkippingConflicts: vi.fn(async (values: FileFolderInsert[], _tx: DbOrTx) =>
      values.flatMap((value) => {
        const clash = live().some(
          (row) =>
            (row.parentId === (value.parentId ?? null) &&
              row.name.toLowerCase() === value.name.toLowerCase()) ||
            (value.kind === 'personal' && row.kind === 'personal' && row.ownerId === value.ownerId),
        );
        return clash ? [] : [insert({ ...value, parentId: value.parentId ?? null })];
      }),
    ),
    findChildNames: vi.fn(
      async (parentId: string, _tx?: DbOrTx) =>
        new Set(
          live()
            .filter((row) => row.parentId === parentId)
            .map((row) => row.name.toLowerCase()),
        ),
    ),
    findActiveUserIds: vi.fn(async () => PEOPLE.map((person) => person.id)),
    findPersonalOwnerIds: vi.fn(
      async (userIds: readonly string[], _tx?: DbOrTx) =>
        new Set(
          live()
            .filter(
              (row) => row.kind === 'personal' && row.ownerId && userIds.includes(row.ownerId),
            )
            .map((row) => row.ownerId ?? ''),
        ),
    ),
    findUsers: vi.fn(async (userIds: readonly string[]) =>
      PEOPLE.filter((person) => userIds.includes(person.id)),
    ),
    hasSibling: vi.fn(async (parentId: string | null, name: string) =>
      live().some(
        (row) => row.parentId === parentId && row.name.toLowerCase() === name.toLowerCase(),
      ),
    ),
    findPersonalOfDeletedOwners: vi.fn(async (ownerIds?: readonly string[], _tx?: DbOrTx) =>
      live().filter(
        (row) =>
          row.kind === 'personal' &&
          row.ownerId !== null &&
          deletedOwners.has(row.ownerId) &&
          (!ownerIds || ownerIds.includes(row.ownerId)),
      ),
    ),
    isEmpty: vi.fn(async (id: string, _tx?: DbOrTx) => !nonEmpty.has(id)),
    softDelete: vi.fn(async (ids: readonly string[], stamp: DeletionStamp, _tx?: DbOrTx) => {
      for (const id of ids) {
        const row = rows.get(id);
        if (row) row.deletedAt = stamp.deletedAt;
      }
      return ids.length;
    }),
  };
  const grantStore = new Map<string, { key: GrantKey; level: GrantLevel }>();
  const grants = {
    createForNewFolders: vi.fn(
      async (
        entries: readonly (GrantKey & { level: GrantLevel; grantedBy: string | null })[],
        _tx: DbOrTx,
      ) => {
        for (const entry of entries) {
          grantStore.set(`${entry.folderId}|${entry.subjectType}|${entry.subjectId}`, {
            key: entry,
            level: entry.level,
          });
        }
      },
    ),
    set: vi.fn(
      async (
        key: GrantKey,
        values: { level: GrantLevel; expiresAt: Date | null; grantedBy: string | null },
        _tx: DbOrTx,
      ) => {
        grantStore.set(`${key.folderId}|${key.subjectType}|${key.subjectId}`, {
          key,
          level: values.level,
        });
      },
    ),
  };
  const permissionMap = options.permissions ?? {
    [ALICE.id]: { keys: ['file:access'] },
    [BOB.id]: { keys: ['file:access', 'file:read'] },
    [CAROL.id]: { keys: ['user:read'] },
  };
  const permissions = {
    getPermissionSets: vi.fn(
      async (userIds: readonly string[]) =>
        new Map<string, PermissionSet>(
          userIds.map((id) => [
            id,
            {
              permissions: new Set(permissionMap[id]?.keys ?? []),
              isSuperAdmin: permissionMap[id]?.isSuperAdmin ?? false,
            },
          ]),
        ),
    ),
  };
  const audit = {
    record: vi.fn(async (_entry: Record<string, unknown>, _tx?: DbOrTx) => undefined),
    recordMany: vi.fn(async (_entries: Record<string, unknown>[], _tx?: DbOrTx) => undefined),
  };
  const handlers = new Map<string, Handler>();
  const unsubscribe = vi.fn();
  const events = {
    publish: vi.fn(),
    subscribe: vi.fn((type: string, handler: Handler) => {
      handlers.set(type, handler);
      return unsubscribe;
    }),
  };
  /** savepoint：失敗時把這段期間的資料夾變更還原。 */
  const tx = {
    transaction: vi.fn(async <T>(work: (savepoint: DbOrTx) => Promise<T>) => {
      const before = new Map(rows);
      try {
        return await work(tx as unknown as DbOrTx);
      } catch (error) {
        rows.clear();
        for (const [id, row] of before) rows.set(id, row);
        throw error;
      }
    }),
  };
  const tree = {
    write: vi.fn(async <T>(work: (db: DbOrTx) => Promise<T>) => work(tx as unknown as DbOrTx)),
  };
  const tenancy = { forEachActive: vi.fn(async (fn: () => Promise<void>) => fn()) };
  const service = new FileSystemFolderService(
    tree as unknown as FileFolderTree,
    repo as unknown as FileFolderRepository,
    grants as unknown as FileFolderGrantRepository,
    permissions as unknown as PermissionService,
    audit as unknown as AuditService,
    events as unknown as DomainEventBus,
    tenancy as unknown as Tenancy,
    { get: () => options.appRoles ?? 'all' } as unknown as ConfigService<Env, true>,
  );
  const emit = async <T extends DomainEvent>(type: T, payload: DomainEventPayloads[T]) => {
    const handler = handlers.get(type);
    await (handler as ((value: DomainEventPayloads[T]) => unknown) | undefined)?.(payload);
  };
  const personalOf = (ownerId: string) =>
    live().find((row) => row.kind === 'personal' && row.ownerId === ownerId);
  return {
    service,
    rows,
    live,
    repo,
    grants,
    grantStore,
    permissions,
    audit,
    events,
    unsubscribe,
    emit,
    tenancy,
    nonEmpty,
    insert,
    personalOf,
  };
}

const FOLDER_CREATED = {
  changes: [{ resource: ChangeSource.FILE_FOLDER, kind: ChangeKind.CREATE }],
};

describe('FileSystemFolderService.ensureSystemFolders（docs/architecture/iam/06-resource-grants.md §12）', () => {
  it('都沒有 → 在根目錄建立共用資料夾與私人資料夾，回傳私人資料夾', async () => {
    const { service, live } = systemSetup();
    const privateRoot = await service.ensureSystemFolders();
    expect(live().map((row) => [row.name, row.kind, row.parentId])).toEqual([
      [SHARED_FOLDER_NAME, 'shared', null],
      [PRIVATE_ROOT_FOLDER_NAME, 'privateRoot', null],
    ]);
    expect(privateRoot.kind).toBe('privateRoot');
  });

  it('新建的共用資料夾授予所有人（everyone）editor；私人資料夾沒有授權', async () => {
    const { service, grantStore, live } = systemSetup();
    await service.ensureSystemFolders();
    const shared = live().find((row) => row.kind === 'shared');
    expect([...grantStore.values()]).toEqual([
      {
        key: { folderId: shared?.id, subjectType: 'everyone', subjectId: EVERYONE_SUBJECT_ID },
        level: 'editor',
      },
    ]);
  });

  it('建立的稽核操作者是 system', async () => {
    const { service, audit } = systemSetup();
    await service.ensureSystemFolders();
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'fileFolder.create',
        actorId: null,
        actorEmail: 'system',
        changes: { after: { name: SHARED_FOLDER_NAME, kind: 'shared' } },
      }),
      expect.anything(),
    );
  });

  it('有建立 → 推 fileFolder create', async () => {
    const { service, events } = systemSetup();
    await service.ensureSystemFolders();
    expect(events.publish).toHaveBeenCalledWith(DomainEvent.RESOURCE_CHANGED, FOLDER_CREATED);
  });

  it('已存在 → 冪等：不建立、不授權、不推播', async () => {
    const { service, repo, grants, events } = systemSetup({
      folders: [
        { name: SHARED_FOLDER_NAME, kind: 'shared' },
        { name: PRIVATE_ROOT_FOLDER_NAME, kind: 'privateRoot' },
      ],
    });
    await service.ensureSystemFolders();
    expect(repo.create).not.toHaveBeenCalled();
    expect(grants.set).not.toHaveBeenCalled();
    expect(events.publish).not.toHaveBeenCalled();
  });

  it('根目錄已有同名（不分大小寫）的一般資料夾 → 標成系統資料夾沿用，不另建', async () => {
    const { service, repo, live } = systemSetup({
      folders: [{ name: SHARED_FOLDER_NAME, kind: 'normal' }],
    });
    await service.ensureSystemFolders();
    expect(live().filter((row) => row.name === SHARED_FOLDER_NAME)).toEqual([
      expect.objectContaining({ kind: 'shared' }),
    ]);
    expect(repo.create).toHaveBeenCalledTimes(1);
  });

  it('沿用的同名一般資料夾也補上 everyone editor', async () => {
    const { service, grantStore, live } = systemSetup({
      folders: [{ name: SHARED_FOLDER_NAME, kind: 'normal' }],
    });
    await service.ensureSystemFolders();
    const shared = live().find((row) => row.kind === 'shared');
    expect(grantStore.get(`${shared?.id}|everyone|${EVERYONE_SUBJECT_ID}`)?.level).toBe('editor');
  });

  it('同名但不在根目錄的資料夾不沿用', async () => {
    const { service, insert, live } = systemSetup();
    const parent = insert({ name: '外層' });
    insert({ name: SHARED_FOLDER_NAME, parentId: parent.id });
    await service.ensureSystemFolders();
    expect(live().filter((row) => row.kind === 'shared')).toEqual([
      expect.objectContaining({ parentId: null }),
    ]);
  });

  it('建立失敗（沒有回傳列）→ 拋錯', async () => {
    const { service, repo } = systemSetup();
    repo.create.mockResolvedValueOnce([]);
    await expect(service.ensureSystemFolders()).rejects.toThrow(SHARED_FOLDER_NAME);
  });
});

describe('FileSystemFolderService.ensurePersonalFolders（docs/architecture/iam/06-resource-grants.md §12）', () => {
  it('在私人資料夾底下建立個人資料夾：本人擁有、不繼承上層', async () => {
    const { service, live, personalOf } = systemSetup();
    await service.ensurePersonalFolders([ALICE.id]);
    const privateRoot = live().find((row) => row.kind === 'privateRoot');
    expect(personalOf(ALICE.id)).toEqual(
      expect.objectContaining({
        name: 'Alice',
        parentId: privateRoot?.id,
        ownerId: ALICE.id,
        inheritGrants: false,
        createdBy: ALICE.id,
      }),
    );
  });

  it('授予本人 manager', async () => {
    const { service, grantStore, personalOf } = systemSetup();
    await service.ensurePersonalFolders([ALICE.id]);
    const folder = personalOf(ALICE.id);
    expect(grantStore.get(`${folder?.id}|user|${ALICE.id}`)?.level).toBe('manager');
  });

  it('稽核：fileFolder.create，操作者是 system，記下擁有者', async () => {
    const { service, audit, personalOf } = systemSetup();
    await service.ensurePersonalFolders([ALICE.id]);
    expect(audit.recordMany).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          action: 'fileFolder.create',
          resourceId: personalOf(ALICE.id)?.id,
          actorId: null,
          actorEmail: 'system',
          changes: { after: { name: 'Alice', kind: 'personal', ownerId: ALICE.id } },
        }),
      ],
      expect.anything(),
    );
  });

  it('一批人一次寫入：資料夾、授權、稽核各一個多列 INSERT，不逐人查詢名稱', async () => {
    const { service, repo, grants, audit } = systemSetup();
    await service.ensurePersonalFolders([ALICE.id, BOB.id, CAROL.id]);
    expect(repo.createSkippingConflicts).toHaveBeenCalledTimes(1);
    expect(grants.createForNewFolders).toHaveBeenCalledTimes(1);
    expect(audit.recordMany).toHaveBeenCalledTimes(1);
    expect(repo.hasSibling).not.toHaveBeenCalled();
  });

  it('同一批的人顯示名稱相同（不分大小寫）→ 後面的人改用下一個候選名稱', async () => {
    const { service, repo, personalOf } = systemSetup();
    const twin = {
      id: '44444444-4444-4444-8444-444444444444',
      displayName: 'alice',
      email: 'a2@example.com',
    };
    repo.findUsers.mockResolvedValueOnce([ALICE, twin]);
    await service.ensurePersonalFolders([ALICE.id, twin.id]);
    expect(personalOf(ALICE.id)?.name).toBe('Alice');
    expect(personalOf(twin.id)?.name).toBe('alice (a2@example.com)');
  });

  it('批次寫入時被唯一索引略過的人 → 改走逐人建立（以資料庫查詢挑名稱）', async () => {
    const { service, repo, insert, personalOf } = systemSetup();
    const privateRoot = await service.ensureSystemFolders();
    insert({ name: 'ALICE', parentId: privateRoot.id });
    // 記憶體裡的比對沒看到撞名（例：大小寫規則與 Postgres 的 lower() 不同），由唯一索引擋下
    repo.findChildNames.mockResolvedValueOnce(new Set());
    await service.ensurePersonalFolders([ALICE.id]);
    expect(repo.hasSibling).toHaveBeenCalled();
    expect(personalOf(ALICE.id)?.name).toBe('Alice (alice@example.com)');
  });

  it('同一層撞名 → 改用下一個候選名稱', async () => {
    const { service, insert, personalOf } = systemSetup();
    const privateRoot = await service.ensureSystemFolders();
    insert({ name: 'alice', parentId: privateRoot.id });
    await service.ensurePersonalFolders([ALICE.id]);
    expect(personalOf(ALICE.id)?.name).toBe('Alice (alice@example.com)');
  });

  it('已有個人資料夾的人略過；都有時不進入寫入', async () => {
    const { service, repo } = systemSetup();
    await service.ensurePersonalFolders([ALICE.id]);
    repo.findUsers.mockClear();
    await service.ensurePersonalFolders([ALICE.id]);
    expect(repo.findUsers).not.toHaveBeenCalled();
  });

  it('重複的 id 只建一次', async () => {
    const { service, live } = systemSetup();
    await service.ensurePersonalFolders([ALICE.id, ALICE.id]);
    expect(live().filter((row) => row.kind === 'personal')).toHaveLength(1);
  });

  it('空名單 → 什麼都不做', async () => {
    const { service, repo } = systemSetup();
    await service.ensurePersonalFolders([]);
    expect(repo.findPersonalOwnerIds).not.toHaveBeenCalled();
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('onlyEligible：只為有 file:access 的人建立', async () => {
    const { service, personalOf } = systemSetup();
    await service.ensurePersonalFolders([ALICE.id, BOB.id, CAROL.id], { onlyEligible: true });
    expect([ALICE, BOB, CAROL].map((person) => Boolean(personalOf(person.id)))).toEqual([
      true,
      true,
      false,
    ]);
  });

  it('onlyEligible：super-admin 沒有 file:access 也建立', async () => {
    const { service, personalOf } = systemSetup({
      permissions: { [CAROL.id]: { keys: [], isSuperAdmin: true } },
    });
    await service.ensurePersonalFolders([CAROL.id], { onlyEligible: true });
    expect(personalOf(CAROL.id)).toBeDefined();
  });

  it('onlyEligible：沒有人符合 → 不建立系統資料夾', async () => {
    const { service, repo } = systemSetup();
    await service.ensurePersonalFolders([CAROL.id], { onlyEligible: true });
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('排隊後重查：已被併發的請求建好的人不重複建立', async () => {
    const { service, repo, live } = systemSetup();
    await service.ensurePersonalFolders([ALICE.id]);
    // 交易外查不到，取得樹鎖之後才看到別人建好的
    repo.findPersonalOwnerIds
      .mockResolvedValueOnce(new Set())
      .mockResolvedValueOnce(new Set([ALICE.id]));
    await service.ensurePersonalFolders([ALICE.id]);
    expect(live().filter((row) => row.kind === 'personal')).toHaveLength(1);
  });

  it('批次失敗 → 退回逐人建立；一個人建立失敗只略過他，同一批其他人照常建立', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { service, grants, personalOf } = systemSetup();
    grants.createForNewFolders.mockRejectedValue(new Error('boom'));
    grants.set.mockImplementation(async (key: GrantKey) => {
      if (key.subjectId === ALICE.id) throw new Error('unique violation');
    });
    await service.ensurePersonalFolders([ALICE.id, BOB.id]);
    expect(personalOf(ALICE.id)).toBeUndefined();
    expect(personalOf(BOB.id)).toBeDefined();
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ userId: ALICE.id }),
      expect.any(String),
    );
    warn.mockRestore();
  });

  it('個人資料夾全部建立失敗 → 不推播；有建立 → 推 fileFolder create', async () => {
    const { service, events, grants } = systemSetup({
      folders: [
        { name: SHARED_FOLDER_NAME, kind: 'shared' },
        { name: PRIVATE_ROOT_FOLDER_NAME, kind: 'privateRoot' },
      ],
    });
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    grants.createForNewFolders.mockRejectedValue(new Error('boom'));
    grants.set.mockRejectedValue(new Error('boom'));
    await service.ensurePersonalFolders([ALICE.id]);
    expect(events.publish).not.toHaveBeenCalled();
    grants.createForNewFolders.mockResolvedValue(undefined);
    await service.ensurePersonalFolders([ALICE.id]);
    expect(events.publish).toHaveBeenCalledWith(DomainEvent.RESOURCE_CHANGED, FOLDER_CREATED);
    warn.mockRestore();
  });
});

/** 兩個個人資料夾：Alice、Bob 各一。 */
function withPersonal(options: Omit<SystemSetupOptions, 'folders'> = {}) {
  const setup = systemSetup(options);
  const alice = setup.insert({ name: 'Alice', kind: 'personal', ownerId: ALICE.id });
  const bob = setup.insert({ name: 'Bob', kind: 'personal', ownerId: BOB.id });
  return { ...setup, alice, bob };
}

describe('FileSystemFolderService.removeEmptyPersonalFolders（docs/architecture/iam/06-resource-grants.md §12）', () => {
  it('空名單 → 不進入寫入', async () => {
    const { service, repo } = withPersonal({ deletedOwners: [ALICE.id] });
    await service.removeEmptyPersonalFolders([]);
    expect(repo.findPersonalOfDeletedOwners).not.toHaveBeenCalled();
  });

  it('擁有者已刪除且是空的 → 軟刪除（操作者是 system）', async () => {
    const { service, repo, alice } = withPersonal({ deletedOwners: [ALICE.id] });
    await service.removeEmptyPersonalFolders([ALICE.id]);
    expect(alice.deletedAt).not.toBeNull();
    expect(repo.softDelete).toHaveBeenCalledWith(
      [alice.id],
      expect.objectContaining({ actorId: null }),
      expect.anything(),
    );
  });

  it('擁有者已刪除但裡面有東西 → 保留', async () => {
    const { service, nonEmpty, alice, audit } = withPersonal({ deletedOwners: [ALICE.id] });
    nonEmpty.add(alice.id);
    await service.removeEmptyPersonalFolders([ALICE.id]);
    expect(alice.deletedAt).toBeNull();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('稽核：fileFolder.delete，reason 是 owner-deleted', async () => {
    const { service, audit, alice } = withPersonal({ deletedOwners: [ALICE.id] });
    await service.removeEmptyPersonalFolders([ALICE.id]);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'fileFolder.delete',
        resourceId: alice.id,
        actorId: null,
        actorEmail: 'system',
        changes: { before: { name: 'Alice', kind: 'personal', ownerId: ALICE.id } },
        metadata: { reason: 'owner-deleted' },
      }),
      expect.anything(),
    );
  });

  it('不帶名單 → 檢查所有已刪除擁有者的個人資料夾', async () => {
    const { service, alice, bob } = withPersonal({ deletedOwners: [ALICE.id, BOB.id] });
    await service.removeEmptyPersonalFolders();
    expect([alice.deletedAt, bob.deletedAt].every((value) => value !== null)).toBe(true);
  });

  it('有刪除 → 每個資料夾推一筆 fileFolder delete', async () => {
    const { service, events, alice, bob } = withPersonal({ deletedOwners: [ALICE.id, BOB.id] });
    await service.removeEmptyPersonalFolders();
    expect(events.publish).toHaveBeenCalledWith(DomainEvent.RESOURCE_CHANGED, {
      changes: [
        { resource: ChangeSource.FILE_FOLDER, kind: ChangeKind.DELETE, id: alice.id },
        { resource: ChangeSource.FILE_FOLDER, kind: ChangeKind.DELETE, id: bob.id },
      ],
    });
  });

  it('沒有可刪的 → 不推播', async () => {
    const { service, events } = withPersonal();
    await service.removeEmptyPersonalFolders();
    expect(events.publish).not.toHaveBeenCalled();
  });
});

describe('FileSystemFolderService 的生命週期與事件訂閱（docs/architecture/iam/06-resource-grants.md §12）', () => {
  it('啟動時對每個 active 的租戶準備系統資料夾與個人資料夾', async () => {
    const { service, tenancy, live, personalOf } = systemSetup();
    await service.onApplicationBootstrap();
    expect(tenancy.forEachActive).toHaveBeenCalledTimes(1);
    expect(live().some((row) => row.kind === 'shared')).toBe(true);
    expect(personalOf(ALICE.id)).toBeDefined();
    expect(personalOf(CAROL.id)).toBeUndefined();
  });

  it('沒有 worker 角色的程序啟動時不進入每個租戶（docs/architecture/01-system.md §7 D3）', async () => {
    const { service, tenancy } = systemSetup({ appRoles: 'http,realtime' });
    await service.onApplicationBootstrap();
    expect(tenancy.forEachActive).not.toHaveBeenCalled();
  });

  it('準備租戶時也清掉已刪除擁有者的空個人資料夾', async () => {
    const setup = systemSetup({ deletedOwners: [BOB.id] });
    const bob = setup.insert({ name: 'Bob', kind: 'personal', ownerId: BOB.id });
    await setup.service.prepareTenant();
    expect(bob.deletedAt).not.toBeNull();
  });

  it('permissions.changed 帶名單 → 為其中能進檔案管理器的人補建', async () => {
    const { service, emit, personalOf } = systemSetup();
    service.onModuleInit();
    await emit(DomainEvent.PERMISSIONS_CHANGED, { userIds: [BOB.id, CAROL.id] });
    expect(personalOf(BOB.id)).toBeDefined();
    expect(personalOf(CAROL.id)).toBeUndefined();
  });

  it('permissions.changed 沒帶名單（其他程序的廣播）→ 不處理', async () => {
    const { service, emit, permissions } = systemSetup();
    service.onModuleInit();
    await emit(DomainEvent.PERMISSIONS_CHANGED, {});
    expect(permissions.getPermissionSets).not.toHaveBeenCalled();
  });

  it('tenant.activated → 準備這個租戶', async () => {
    const { service, emit, live } = systemSetup();
    service.onModuleInit();
    await emit(DomainEvent.TENANT_ACTIVATED, {});
    expect(live().some((row) => row.kind === 'privateRoot')).toBe(true);
  });

  it('resource.changed 裡的使用者刪除 → 只處理那些使用者的個人資料夾', async () => {
    const setup = systemSetup({ deletedOwners: [ALICE.id, BOB.id] });
    const alice = setup.insert({ name: 'Alice', kind: 'personal', ownerId: ALICE.id });
    const bob = setup.insert({ name: 'Bob', kind: 'personal', ownerId: BOB.id });
    setup.service.onModuleInit();
    await setup.emit(DomainEvent.RESOURCE_CHANGED, {
      changes: [
        { resource: ChangeSource.USER, kind: ChangeKind.DELETE, id: ALICE.id },
        { resource: ChangeSource.USER, kind: ChangeKind.UPDATE, id: BOB.id },
      ],
    });
    expect(alice.deletedAt).not.toBeNull();
    expect(bob.deletedAt).toBeNull();
  });

  it('resource.changed 沒有使用者刪除 → 不查詢', async () => {
    const { service, emit, repo } = systemSetup();
    service.onModuleInit();
    await emit(DomainEvent.RESOURCE_CHANGED, {
      changes: [{ resource: ChangeSource.FILE_FOLDER, kind: ChangeKind.DELETE, id: ALICE.id }],
    });
    expect(repo.findPersonalOfDeletedOwners).not.toHaveBeenCalled();
  });

  it('模組結束時取消全部訂閱', () => {
    const { service, unsubscribe } = systemSetup();
    service.onModuleInit();
    service.onModuleDestroy();
    expect(unsubscribe).toHaveBeenCalledTimes(3);
  });
});
