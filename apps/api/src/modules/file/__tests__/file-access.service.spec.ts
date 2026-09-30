import { describe, expect, it } from 'vitest';

import type { AuthUser } from '@/common/types';
import { AppException } from '@/core/errors';

import type { FolderNode } from '../file-access.context';
import { createFileAccess } from './file-access.fixture';

const ALICE: AuthUser = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'a@x',
  status: 'active',
};
const BOB = '22222222-2222-4222-8222-222222222222';

/** art ─ ui；secret 在旁邊。 */
const ART: FolderNode = { id: 'art', parentId: null, inheritGrants: true, createdBy: BOB };
const UI: FolderNode = { id: 'ui', parentId: 'art', inheritGrants: true, createdBy: ALICE.id };
const SECRET: FolderNode = { id: 'secret', parentId: null, inheritGrants: true, createdBy: BOB };
const NODES = [ART, UI, SECRET];

describe('FileAccessContext（docs/rbac/07-resource-grants.md §3、§4）', () => {
  it('全域權限鍵涵蓋所有資料夾與根目錄，不看資料夾授權', async () => {
    const { access } = createFileAccess({ global: ['read', 'update'], nodes: () => NODES });
    const ctx = await access.contextFor(ALICE);
    expect(ctx.can('read', 'secret')).toBe(true);
    expect(ctx.can('update', null)).toBe(true);
    expect(ctx.can('create', 'art')).toBe(false);
    expect(ctx.readableFolderIds()).toBeUndefined();
  });

  it('只有資料夾授權：根目錄什麼都不能做；等級蘊含的動作往下繼承', async () => {
    const { access } = createFileAccess({
      global: [],
      grants: [{ resourceId: 'art', level: 'contributor' }],
      nodes: () => NODES,
    });
    const ctx = await access.contextFor(ALICE);
    expect(ctx.can('read', null)).toBe(false);
    expect([ctx.can('read', 'ui'), ctx.can('create', 'ui'), ctx.can('update', 'ui')]).toEqual([
      true,
      true,
      false,
    ]);
    expect(ctx.readableFolderIds()).toEqual(['art', 'ui']);
    expect(ctx.rootCapabilities()).toEqual({ canCreate: false });
  });

  it('擁有者規則：能在該位置上傳時，自己建立的項目可以改名、刪除；別人的不行', async () => {
    const { access } = createFileAccess({
      global: [],
      grants: [{ resourceId: 'art', level: 'contributor' }],
      nodes: () => NODES,
    });
    const ctx = await access.contextFor(ALICE);
    expect(ctx.fileCapabilities({ folderId: 'art', createdBy: ALICE.id })).toEqual({
      canUpdate: true,
      canDelete: true,
    });
    expect(ctx.fileCapabilities({ folderId: 'art', createdBy: BOB })).toEqual({
      canUpdate: false,
      canDelete: false,
    });
    // viewer 的位置：自己的也不行（前提是還能上傳）
    const viewer = await createFileAccess({
      global: [],
      grants: [{ resourceId: 'art', level: 'viewer' }],
      nodes: () => NODES,
    }).access.contextFor(ALICE);
    expect(viewer.canModify('delete', 'art', ALICE.id)).toBe(false);
  });

  it('資料夾本身的操作看上層：被分享的資料夾不能被改名，但 ui（自己建立、在 art 裡）可以', async () => {
    const { access } = createFileAccess({
      global: [],
      grants: [{ resourceId: 'art', level: 'contributor' }],
      nodes: () => NODES,
    });
    const ctx = await access.contextFor(ALICE);
    expect(ctx.folderCapabilities(ART)).toMatchObject({ canCreate: true, canUpdate: false });
    expect(ctx.folderCapabilities(UI)).toMatchObject({ canUpdate: true, canDelete: true });
  });

  it('沒有 read 的資料夾是鎖住的（canRead = false），但仍然存在', async () => {
    const { access } = createFileAccess({
      global: [],
      grants: [{ resourceId: 'ui', level: 'viewer' }],
      nodes: () => NODES,
    });
    const ctx = await access.contextFor(ALICE);
    expect(ctx.folderCapabilities(ART)).toEqual({
      canRead: false,
      canCreate: false,
      canUpdate: false,
      canDelete: false,
      canShare: false,
    });
    expect(ctx.folderCapabilities(UI).canRead).toBe(true);
    expect(ctx.exists('art')).toBe(true);
    expect(ctx.exists('missing')).toBe(false);
  });

  it('反提權：授予得起的等級不超過自己在該資料夾的能力（全域與等級取聯集）', async () => {
    const onlyShare = await createFileAccess({
      global: ['share'],
      nodes: () => NODES,
    }).access.contextFor(ALICE);
    // 權限依賴樹：file:share ⇒ file:read（docs/rbac/02-permission-catalog.md §9），所以只給 share 也授予得起 viewer
    expect(onlyShare.assignableLevels('art')).toEqual(['viewer']);

    const readShare = await createFileAccess({
      global: ['read', 'share'],
      nodes: () => NODES,
    }).access.contextFor(ALICE);
    expect(readShare.assignableLevels('art')).toEqual(['viewer']);

    const manager = await createFileAccess({
      global: [],
      grants: [{ resourceId: 'art', level: 'manager' }],
      nodes: () => NODES,
    }).access.contextFor(ALICE);
    expect(manager.assignableLevels('ui')).toEqual(['viewer', 'contributor', 'editor', 'manager']);
    expect(manager.missingActions(['manager'], 'secret')).toEqual([
      'read',
      'create',
      'update',
      'delete',
      'share',
    ]);
  });
});

describe('FileAccessService.assertCan', () => {
  it('不存在的資料夾 → FILE_FOLDER_NOT_FOUND；鎖住或不能做 → AUTHZ_FORBIDDEN 並寫 authz.denied', async () => {
    const { access, audit } = createFileAccess({
      global: [],
      grants: [{ resourceId: 'art', level: 'viewer' }],
      nodes: () => NODES,
    });
    const ctx = await access.contextFor(ALICE);

    const missing = await access.assertCan(ctx, ALICE, 'create', 'nope').catch((e: unknown) => e);
    expect((missing as AppException).code).toBe('FILE_FOLDER_NOT_FOUND');
    expect(audit.recordSafely).not.toHaveBeenCalled();

    const locked = await access.assertCan(ctx, ALICE, 'read', 'secret').catch((e: unknown) => e);
    expect((locked as AppException).code).toBe('AUTHZ_FORBIDDEN');

    const denied = await access.assertCan(ctx, ALICE, 'create', 'art').catch((e: unknown) => e);
    expect(denied).toBeInstanceOf(AppException);
    expect((denied as AppException).code).toBe('AUTHZ_FORBIDDEN');
    expect(audit.recordSafely).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'authz.denied',
        metadata: { action: 'create', resourceType: 'fileFolder', resourceId: 'art' },
      }),
    );
  });
});
