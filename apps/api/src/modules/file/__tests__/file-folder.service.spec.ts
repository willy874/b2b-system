import { describe, expect, it, vi } from 'vitest';

import type { AuthUser } from '@/common/types';
import type { Database } from '@/core/database';
import { AppException } from '@/core/errors';
import type { DomainEventBus } from '@/core/events';
import type { FileFolderRow, GrantLevel } from '@/db/schema';
import type { AuditService } from '@/modules/audit-log/audit.service';
import type { LevelGrant } from '@/modules/resource-grant/resource-grant.resolver';

import type { FileAccessRequestService } from '../file-access-request.service';
import { FileFolderTree } from '../file-folder-tree';
import type { FileFolderRepository } from '../file-folder.repository';
import { FileFolderService } from '../file-folder.service';
import { MAX_FOLDER_DEPTH } from '../file.constants';
import { createFileAccess } from './file-access.fixture';
import type { AccessFixtureOptions } from './file-access.fixture';

const ALICE: AuthUser = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'a@x',
  status: 'active',
};
const BOB_ID = '22222222-2222-4222-8222-222222222222';

let sequence = 0;
function uuid(): string {
  sequence += 1;
  return `00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`;
}

/**
 * 以記憶體裡的一棵樹模擬 repository：service 的規則（同名、循環、遞迴）都建立在查詢結果上，
 * 用假的樹比逐一 mock 每個查詢更能看出行為。
 */
function setup(
  initial: { name: string; parent?: string; createdBy?: string; inherit?: boolean }[] = [],
  accessOptions: Omit<AccessFixtureOptions, 'nodes'> = {},
  foreignFiles = false,
) {
  const folders = new Map<string, FileFolderRow>();
  const byName = new Map<string, string>();
  const now = new Date('2026-09-27T00:00:00Z');
  function insert(
    name: string,
    parentId: string | null,
    createdBy = ALICE.id,
    inheritGrants = true,
  ): FileFolderRow {
    const row: FileFolderRow = {
      id: uuid(),
      name,
      parentId,
      inheritGrants,
      kind: 'normal',
      ownerId: null,
      createdAt: now,
      createdBy,
      updatedAt: now,
      updatedBy: ALICE.id,
      deletedAt: null,
    };
    folders.set(row.id, row);
    return row;
  }
  for (const entry of initial) {
    const parentId = entry.parent ? (byName.get(entry.parent) ?? null) : null;
    byName.set(entry.name, insert(entry.name, parentId, entry.createdBy, entry.inherit).id);
  }
  const live = () => [...folders.values()].filter((row) => !row.deletedAt);
  const idOf = (name: string) => {
    const id = byName.get(name);
    if (!id) throw new Error(`no folder ${name}`);
    return id;
  };

  const repo = {
    lockTree: vi.fn(async () => undefined),
    findMovableFiles: vi.fn(async (ids: string[]) =>
      ids.map((id) => ({ id, folderId: null as string | null, createdBy: ALICE.id })),
    ),
    hasItemsNotCreatedBy: vi.fn(
      async (ids: string[], actorId: string) =>
        foreignFiles || live().some((row) => ids.includes(row.id) && row.createdBy !== actorId),
    ),
    listAll: vi.fn(async () => live()),
    findById: vi.fn(async (id: string) => live().find((row) => row.id === id)),
    findByIds: vi.fn(async (ids: string[]) => live().filter((row) => ids.includes(row.id))),
    findChildren: vi.fn(async (parentIds: (string | null)[]) =>
      live().filter((row) => parentIds.includes(row.parentId)),
    ),
    findAncestorIds: vi.fn(async (id: string) => {
      const chain: string[] = [];
      let current = live().find((row) => row.id === id);
      while (current) {
        chain.push(current.id);
        const parentId: string | null = current.parentId;
        current = parentId ? folders.get(parentId) : undefined;
      }
      return chain;
    }),
    findDescendantIds: vi.fn(async (ids: string[]) => {
      const result = new Set(ids);
      let grew = true;
      while (grew) {
        grew = false;
        for (const row of live()) {
          if (row.parentId && result.has(row.parentId) && !result.has(row.id)) {
            result.add(row.id);
            grew = true;
          }
        }
      }
      return [...result];
    }),
    findMaxSubtreeHeight: vi.fn(async (ids: string[]) => {
      const heightOf = (id: string): number =>
        1 +
        Math.max(
          0,
          ...live()
            .filter((row) => row.parentId === id)
            .map((row) => heightOf(row.id)),
        );
      return Math.max(0, ...ids.filter((id) => folders.has(id)).map(heightOf));
    }),
    create: vi.fn(async (values: { name: string; parentId?: string | null }[]) =>
      values.map((value) => insert(value.name, value.parentId ?? null)),
    ),
    rename: vi.fn(async (id: string, values: { name: string }) => {
      const row = folders.get(id);
      if (row) row.name = values.name;
      return row;
    }),
    move: vi.fn(async (ids: string[], parentId: string | null) =>
      ids.flatMap((id) => {
        const row = folders.get(id);
        if (!row || row.parentId === parentId) return [];
        row.parentId = parentId;
        return [row];
      }),
    ),
    moveFiles: vi.fn(async (fileIds: string[]) => fileIds.length),
    softDelete: vi.fn(async (ids: string[]) => {
      for (const id of ids) {
        const row = folders.get(id);
        if (row) row.deletedAt = now;
      }
      return ids.length;
    }),
    softDeleteFilesIn: vi.fn(async (_folderIds: string[]) => 3),
    hasSibling: vi.fn(async (parentId: string | null, name: string, exceptId?: string) =>
      live().some(
        (row) =>
          row.parentId === parentId &&
          row.name.toLowerCase() === name.toLowerCase() &&
          row.id !== exceptId,
      ),
    ),
  };
  const audit = { record: vi.fn(async () => undefined) };
  const events = { publish: vi.fn() };
  const db = { transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn('tx')) };
  const fixture = createFileAccess({
    ...accessOptions,
    nodes: () =>
      live().map((row) => ({
        id: row.id,
        parentId: row.parentId,
        inheritGrants: row.inheritGrants,
        createdBy: row.createdBy,
      })),
  });
  const requests = { pendingFolderIdsOf: vi.fn(async () => new Set<string>()) };
  const service = new FileFolderService(
    db as unknown as Database,
    repo as unknown as FileFolderRepository,
    audit as unknown as AuditService,
    events as unknown as DomainEventBus,
    fixture.access,
    requests as unknown as FileAccessRequestService,
    new FileFolderTree(db as unknown as Database, repo as unknown as FileFolderRepository),
  );
  return { service, repo, audit, events, idOf, folders: live, denials: fixture.audit };
}

async function expectAppError(promise: Promise<unknown>, code: string) {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(AppException);
  expect((error as AppException).code).toBe(code);
}

describe('FileFolderService.create（docs/architecture/backend/09-file.md §4.2）', () => {
  it('在交易內排隊後建立、寫稽核、發推播', async () => {
    const { service, repo, audit, events } = setup();
    const folder = await service.create({ name: '角色', parentId: null }, ALICE);

    expect(folder).toMatchObject({ name: '角色', parentId: null });
    expect(repo.lockTree).toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'fileFolder.create', resourceId: folder.id }),
      'tx',
    );
    expect(events.publish).toHaveBeenCalledTimes(1);
  });

  it('同一層已有同名（不分大小寫）回 FILE_FOLDER_NAME_CONFLICT', async () => {
    const { service } = setup([{ name: 'Sprites' }]);
    await expectAppError(
      service.create({ name: 'sprites', parentId: null }, ALICE),
      'FILE_FOLDER_NAME_CONFLICT',
    );
  });

  it('不同層可以同名', async () => {
    const { service, idOf } = setup([{ name: 'a' }, { name: 'b' }]);
    await service.create({ name: 'shared', parentId: idOf('a') }, ALICE);
    await expect(
      service.create({ name: 'shared', parentId: idOf('b') }, ALICE),
    ).resolves.toMatchObject({ name: 'shared' });
  });

  it('上層不存在回 FILE_FOLDER_NOT_FOUND', async () => {
    const { service } = setup();
    await expectAppError(
      service.create({ name: 'x', parentId: uuid() }, ALICE),
      'FILE_FOLDER_NOT_FOUND',
    );
  });
});

describe('FileFolderService.ensurePaths（上傳資料夾）', () => {
  it('沿用既有的同名資料夾、只建立缺少的，回傳每條路徑最後一層的 id', async () => {
    const { service, repo, idOf, folders } = setup([
      { name: 'assets' },
      { name: 'img', parent: 'assets' },
    ]);
    const result = await service.ensurePaths(
      {
        parentId: null,
        paths: [
          ['Assets', 'img'],
          ['assets', 'img', 'ui'],
          ['assets', 'sfx'],
        ],
      },
      ALICE,
    );

    expect(result.items[0]).toEqual({ path: ['Assets', 'img'], id: idOf('img') });
    const created = repo.create.mock.calls.flatMap(([values]) => values.map((v) => v.name));
    expect(created.toSorted()).toEqual(['sfx', 'ui']);
    const ui = folders().find((row) => row.name === 'ui');
    expect(ui?.parentId).toBe(idOf('img'));
    expect(result.items[1]?.id).toBe(ui?.id);
  });

  it('根目錄起算剛好到深度上限可以；在一層資料夾底下再加滿就回 VALIDATION_FAILED', async () => {
    const { service, idOf } = setup([{ name: 'a' }]);
    const deep = Array.from({ length: MAX_FOLDER_DEPTH }, (_, i) => `d${i}`);
    await service.ensurePaths({ parentId: null, paths: [deep] }, ALICE);
    await expectAppError(
      service.ensurePaths({ parentId: idOf('a'), paths: [deep] }, ALICE),
      'VALIDATION_FAILED',
    );
  });
});

describe('FileFolderService.rename', () => {
  it('同一層已有同名回 FILE_FOLDER_NAME_CONFLICT；改成自己原本的名稱不算衝突', async () => {
    const { service, idOf } = setup([{ name: 'a' }, { name: 'b' }]);
    await expectAppError(
      service.rename(idOf('a'), { name: 'B' }, ALICE),
      'FILE_FOLDER_NAME_CONFLICT',
    );
    await expect(service.rename(idOf('a'), { name: 'A' }, ALICE)).resolves.toMatchObject({
      name: 'A',
    });
  });
});

describe('FileFolderService.move', () => {
  it('移到自己或自己的子孫底下回 FILE_FOLDER_CYCLE，不做任何移動', async () => {
    const { service, repo, idOf } = setup([
      { name: 'a' },
      { name: 'b', parent: 'a' },
      { name: 'c', parent: 'b' },
    ]);
    await expectAppError(
      service.move({ fileIds: [], folderIds: [idOf('a')], targetFolderId: idOf('c') }, ALICE),
      'FILE_FOLDER_CYCLE',
    );
    await expectAppError(
      service.move({ fileIds: [], folderIds: [idOf('a')], targetFolderId: idOf('a') }, ALICE),
      'FILE_FOLDER_CYCLE',
    );
    expect(repo.move).not.toHaveBeenCalled();
  });

  it('移動後超過深度上限 → VALIDATION_FAILED(depth)，不做任何移動', async () => {
    const { service, repo, idOf, folders } = setup([{ name: 'a' }, { name: 'b' }]);
    const half = Math.ceil(MAX_FOLDER_DEPTH / 2) + 1;
    const chain = (prefix: string) => Array.from({ length: half }, (_, i) => `${prefix}${i}`);
    await service.ensurePaths({ parentId: idOf('a'), paths: [chain('a')] }, ALICE);
    await service.ensurePaths({ parentId: idOf('b'), paths: [chain('b')] }, ALICE);
    const deepest = folders().find((row) => row.name === `a${half - 1}`);

    const error = await service
      .move({ fileIds: [], folderIds: [idOf('b')], targetFolderId: deepest?.id ?? null }, ALICE)
      .then(
        () => undefined,
        (reason: unknown) => reason as AppException,
      );
    expect(error).toBeInstanceOf(AppException);
    expect(error).toMatchObject({
      code: 'VALIDATION_FAILED',
      details: { field: 'depth', max: MAX_FOLDER_DEPTH },
    });
    expect(repo.move).not.toHaveBeenCalled();
  });

  it('移動後剛好在深度上限內可以移動', async () => {
    const { service, idOf } = setup([{ name: 'a' }, { name: 'b' }]);
    // a 在第 1 層；b 的子樹高度 = MAX - 1 → 移進 a 之後最深剛好 MAX
    const chain = Array.from({ length: MAX_FOLDER_DEPTH - 2 }, (_, i) => `b${i}`);
    await service.ensurePaths({ parentId: idOf('b'), paths: [chain] }, ALICE);
    await expect(
      service.move({ fileIds: [], folderIds: [idOf('b')], targetFolderId: idOf('a') }, ALICE),
    ).resolves.toMatchObject({ movedFolders: 1 });
  });

  it('目的地已有同名、或一起移動的彼此同名，回 FILE_FOLDER_NAME_CONFLICT', async () => {
    const { service, idOf } = setup([
      { name: 'dst' },
      { name: 'x', parent: 'dst' },
      { name: 'p' },
      { name: 'X', parent: 'p' },
    ]);
    await expectAppError(
      service.move({ fileIds: [], folderIds: [idOf('X')], targetFolderId: idOf('dst') }, ALICE),
      'FILE_FOLDER_NAME_CONFLICT',
    );
  });

  it('資料夾不存在回 FILE_FOLDER_NOT_FOUND', async () => {
    const { service } = setup();
    await expectAppError(
      service.move({ fileIds: [], folderIds: [uuid()], targetFolderId: null }, ALICE),
      'FILE_FOLDER_NOT_FOUND',
    );
  });

  it('檔案與資料夾一起移動：回傳數量、寫一筆稽核、推播兩種來源', async () => {
    const { service, repo, audit, events, idOf, folders } = setup([
      { name: 'dst' },
      { name: 'a' },
      { name: 'b', parent: 'a' },
    ]);
    const fileIds = [uuid(), uuid()];
    const result = await service.move(
      { fileIds, folderIds: [idOf('b')], targetFolderId: idOf('dst') },
      ALICE,
    );

    expect(result).toEqual({ movedFiles: 2, movedFolders: 1 });
    expect(folders().find((row) => row.name === 'b')?.parentId).toBe(idOf('dst'));
    expect(repo.moveFiles).toHaveBeenCalledWith(fileIds, idOf('dst'), ALICE.id, 'tx');
    expect(audit.record).toHaveBeenCalledTimes(1);
    const [[event, payload]] = events.publish.mock.calls as [[unknown, { changes: unknown[] }]];
    expect(event).toBeDefined();
    expect(payload.changes).toEqual([
      expect.objectContaining({ resource: 'fileFolder', kind: 'update' }),
      expect.objectContaining({ resource: 'file', kind: 'update' }),
    ]);
  });

  it('本來就在目的地的資料夾不檢查也不移動', async () => {
    const { service, repo, idOf } = setup([{ name: 'a' }]);
    const result = await service.move(
      { fileIds: [], folderIds: [idOf('a')], targetFolderId: null },
      ALICE,
    );
    expect(result).toEqual({ movedFiles: 0, movedFolders: 0 });
    expect(repo.hasSibling).not.toHaveBeenCalled();
  });
});

describe('FileFolderService.remove', () => {
  it('遞迴刪除子孫資料夾與其中的檔案，稽核記下數量', async () => {
    const { service, repo, audit, idOf, folders } = setup([
      { name: 'a' },
      { name: 'b', parent: 'a' },
      { name: 'c', parent: 'b' },
      { name: 'other' },
    ]);
    await service.remove(idOf('a'), ALICE);

    expect(folders().map((row) => row.name)).toEqual(['other']);
    expect(repo.softDeleteFilesIn.mock.calls[0]?.[0]).toHaveLength(3);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'fileFolder.delete',
        changes: expect.objectContaining({
          before: expect.objectContaining({ folderCount: 3, fileCount: 3 }),
        }),
      }),
      'tx',
    );
  });

  it('不存在回 FILE_FOLDER_NOT_FOUND', async () => {
    const { service } = setup();
    await expectAppError(service.remove(uuid(), ALICE), 'FILE_FOLDER_NOT_FOUND');
  });
});

describe('FileFolderService 的資料夾層級授權（docs/rbac/07-resource-grants.md §4、§5.1）', () => {
  /** 只有 `file:access`：沒有任何全域動作，範圍全靠資料夾授權。 */
  function scoped(
    initial: { name: string; parent?: string; createdBy?: string; inherit?: boolean }[],
    grants: (idOf: (name: string) => string) => { name: string; level: GrantLevel }[],
    foreignFiles = false,
  ) {
    const holder: { grants: LevelGrant[] } = { grants: [] };
    const env = setup(initial, { global: [], grants: holder.grants }, foreignFiles);
    for (const grant of grants(env.idOf)) {
      holder.grants.push({ resourceId: env.idOf(grant.name), level: grant.level });
    }
    return env;
  }

  it('清單列出全部資料夾，沒有權限的鎖住（canRead = false）；根目錄不能建立', async () => {
    const { service } = scoped(
      [
        { name: 'root-a' },
        { name: 'art', parent: 'root-a' },
        { name: 'ui', parent: 'art' },
        { name: 'secret' },
      ],
      () => [{ name: 'art', level: 'contributor' }],
    );
    const list = await service.list(ALICE);

    expect(list.items.map((item) => [item.name, item.capabilities.canRead])).toEqual([
      ['root-a', false],
      ['art', true],
      ['ui', true],
      ['secret', false],
    ]);
    expect(list.items[1]?.capabilities).toEqual({
      canRead: true,
      canCreate: true,
      // 被分享的資料夾本身看它的上層（看不到）：不能改名、刪除
      canUpdate: false,
      canDelete: false,
      canShare: false,
    });
    expect(list.rootCapabilities).toEqual({ canCreate: false });
  });

  it('contributor 可以在被授權資料夾裡建立；在根目錄建立 → AUTHZ_FORBIDDEN 並寫 authz.denied', async () => {
    const { service, idOf, denials } = scoped([{ name: 'art' }], () => [
      { name: 'art', level: 'contributor' },
    ]);
    await expect(
      service.create({ name: 'ui', parentId: idOf('art') }, ALICE),
    ).resolves.toMatchObject({ capabilities: { canCreate: true, canUpdate: true } });

    await expectAppError(service.create({ name: 'x', parentId: null }, ALICE), 'AUTHZ_FORBIDDEN');
    expect(denials.recordSafely).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'authz.denied',
        metadata: expect.objectContaining({ action: 'create' }),
      }),
    );
  });

  it('鎖住的資料夾：改名、刪除、當作目的地都回 AUTHZ_FORBIDDEN；不存在的回 FILE_FOLDER_NOT_FOUND', async () => {
    const { service, idOf } = scoped([{ name: 'art' }, { name: 'secret' }], () => [
      { name: 'art', level: 'editor' },
    ]);
    await expectAppError(service.rename(idOf('secret'), { name: 'y' }, ALICE), 'AUTHZ_FORBIDDEN');
    await expectAppError(service.remove(idOf('secret'), ALICE), 'AUTHZ_FORBIDDEN');
    await expectAppError(
      service.move({ fileIds: [], folderIds: [], targetFolderId: idOf('secret') }, ALICE),
      'AUTHZ_FORBIDDEN',
    );
    await expectAppError(service.remove(uuid(), ALICE), 'FILE_FOLDER_NOT_FOUND');
  });

  it('contributor 能改名自己建立的資料夾，不能改名別人建立的；editor 都可以', async () => {
    const initial = [
      { name: 'art' },
      { name: 'mine', parent: 'art' },
      { name: 'theirs', parent: 'art', createdBy: BOB_ID },
    ];
    const contributor = scoped(initial, () => [{ name: 'art', level: 'contributor' }]);
    await contributor.service.rename(contributor.idOf('mine'), { name: 'mine2' }, ALICE);
    await expectAppError(
      contributor.service.rename(contributor.idOf('theirs'), { name: 'x' }, ALICE),
      'AUTHZ_FORBIDDEN',
    );

    const editor = scoped(initial, () => [{ name: 'art', level: 'editor' }]);
    await expect(
      editor.service.rename(editor.idOf('theirs'), { name: 'x' }, ALICE),
    ).resolves.toMatchObject({ name: 'x' });
  });

  it('只靠擁有者規則刪除：子樹全是自己的可以刪；有別人的東西 → AUTHZ_FORBIDDEN（not-owner）', async () => {
    const mine = scoped(
      [{ name: 'art' }, { name: 'mine', parent: 'art' }, { name: 'sub', parent: 'mine' }],
      () => [{ name: 'art', level: 'contributor' }],
    );
    await mine.service.remove(mine.idOf('mine'), ALICE);
    expect(mine.folders().map((row) => row.name)).toEqual(['art']);

    const mixed = scoped(
      [
        { name: 'art' },
        { name: 'mine', parent: 'art' },
        { name: 'bobs', parent: 'mine', createdBy: BOB_ID },
      ],
      () => [{ name: 'art', level: 'contributor' }],
    );
    const error = await mixed.service.remove(mixed.idOf('mine'), ALICE).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppException);
    expect((error as AppException).details).toMatchObject({ reason: 'not-owner' });

    // editor 不受子樹擁有者限制
    const editor = scoped(
      [
        { name: 'art' },
        { name: 'mine', parent: 'art' },
        { name: 'bobs', parent: 'mine', createdBy: BOB_ID },
      ],
      () => [{ name: 'art', level: 'editor' }],
      true,
    );
    await editor.service.remove(editor.idOf('mine'), ALICE);
  });

  it('移動：目的地要能建立、每個項目要能改名；viewer 的目的地 → AUTHZ_FORBIDDEN', async () => {
    const { service, idOf, repo } = scoped(
      [{ name: 'art' }, { name: 'mine', parent: 'art' }, { name: 'view' }],
      () => [
        { name: 'art', level: 'contributor' },
        { name: 'view', level: 'viewer' },
      ],
    );
    await expectAppError(
      service.move({ fileIds: [], folderIds: [idOf('mine')], targetFolderId: idOf('view') }, ALICE),
      'AUTHZ_FORBIDDEN',
    );
    expect(repo.move).not.toHaveBeenCalled();
  });

  it('遞迴刪除：子樹裡有權限不足的私人資料夾 → AUTHZ_FORBIDDEN（protected-subfolder）', async () => {
    const { service, idOf, folders } = scoped(
      [
        { name: 'art' },
        { name: 'sub', parent: 'art' },
        { name: 'private', parent: 'sub', inherit: false },
      ],
      () => [{ name: 'art', level: 'editor' }],
    );
    const error = await service.remove(idOf('sub'), ALICE).catch((e: unknown) => e);
    expect((error as AppException).details).toMatchObject({ reason: 'protected-subfolder' });
    expect(folders()).toHaveLength(3);
  });
});
