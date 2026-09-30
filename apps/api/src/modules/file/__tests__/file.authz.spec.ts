import { describe, expect, it } from 'vitest';

import {
  createChecker,
  createModel,
  createSnapshot,
  impliedRelations,
  ROLE_TYPE,
  tenantEdgeProvider,
  USER_TYPE,
  buildTenantType,
} from '@/core/authz';
import type { TupleEntry } from '@/core/authz';

import type { FolderNode } from '../file-access.context';
import { folderEdgeProvider, itemEdges, locationObject } from '../file-access.snapshot';
import { FILE_AUTHZ_TYPES } from '../file.authz';

const ALICE = 'alice';
const BOB = 'bob';

/** art ─ ui ─ private（中斷繼承）；secret 在旁邊。 */
const FOLDERS: FolderNode[] = [
  { id: 'art', parentId: null, inheritGrants: true, createdBy: BOB },
  { id: 'ui', parentId: 'art', inheritGrants: true, createdBy: ALICE },
  { id: 'private', parentId: 'ui', inheritGrants: false, createdBy: BOB },
  { id: 'secret', parentId: null, inheritGrants: true, createdBy: BOB },
];

const model = (withDependencies = false) =>
  createModel([USER_TYPE, ROLE_TYPE, buildTenantType({ withDependencies }), ...FILE_AUTHZ_TYPES]);

const grant = (folder: string, level: string, subject = `user:${ALICE}`): TupleEntry => ({
  object: { type: 'fileFolder', id: folder },
  relation: level,
  subject,
});
const globalKey = (key: string): TupleEntry => ({
  object: { type: 'tenant', id: 'self' },
  relation: key,
  subject: 'role:r#holder',
});

function checkerFor(tuples: TupleEntry[], withDependencies = false) {
  const folders = new Map(FOLDERS.map((node) => [node.id, node]));
  const snapshot = createSnapshot([`user:${ALICE}`, 'user:*', 'role:r#holder'], tuples, [
    tenantEdgeProvider,
    folderEdgeProvider(folders),
  ]);
  return createChecker(model(withDependencies), snapshot);
}

const can = (checker: ReturnType<typeof checkerFor>, action: string, location: string | null) =>
  checker.check(locationObject(location), `can_${action}`);

describe('檔案管理器的關係模型（docs/rbac/07-resource-grants.md）', () => {
  it('全域權限鍵涵蓋所有資料夾與根目錄，含中斷繼承的資料夾', () => {
    const checker = checkerFor([globalKey('file:read')]);
    expect([null, 'art', 'private', 'secret'].map((f) => can(checker, 'read', f))).toEqual([
      true,
      true,
      true,
      true,
    ]);
    expect(can(checker, 'update', 'art')).toBe(false);
  });

  it('等級往下繼承；根目錄只看全域', () => {
    const checker = checkerFor([grant('art', 'contributor')]);
    expect(can(checker, 'read', null)).toBe(false);
    expect([
      can(checker, 'read', 'ui'),
      can(checker, 'create', 'ui'),
      can(checker, 'update', 'ui'),
    ]).toEqual([true, true, false]);
    expect(can(checker, 'read', 'secret')).toBe(false);
  });

  it('中斷繼承：上層的授權不流進來，直接授權仍有效', () => {
    expect(can(checkerFor([grant('art', 'editor')]), 'read', 'private')).toBe(false);
    expect(
      can(checkerFor([grant('art', 'editor'), grant('private', 'viewer')]), 'read', 'private'),
    ).toBe(true);
  });

  it('同一人多個來源取最高：角色 viewer ＋ 本人 manager', () => {
    const checker = checkerFor([grant('art', 'viewer', 'role:r#holder'), grant('art', 'manager')]);
    expect(can(checker, 'share', 'ui')).toBe(true);
  });

  it('everyone（user:*）對所有人成立', () => {
    expect(can(checkerFor([grant('secret', 'editor', 'user:*')]), 'delete', 'secret')).toBe(true);
  });

  it('規則 A：contributor 能改名、刪除自己建立的，別人的不行；viewer 自己的也不行', () => {
    const contributor = checkerFor([grant('art', 'contributor')]);
    const mine = contributor.withEdges({ type: 'file', id: 'f1' }, itemEdges('art', ALICE));
    const theirs = contributor.withEdges({ type: 'file', id: 'f2' }, itemEdges('art', BOB));
    expect([
      mine.check({ type: 'file', id: 'f1' }, 'can_rename'),
      mine.check({ type: 'file', id: 'f1' }, 'can_remove'),
    ]).toEqual([true, true]);
    expect(theirs.check({ type: 'file', id: 'f2' }, 'can_remove')).toBe(false);

    const viewer = checkerFor([grant('art', 'viewer')]);
    const own = viewer.withEdges({ type: 'file', id: 'f3' }, itemEdges('art', ALICE));
    expect(own.check({ type: 'file', id: 'f3' }, 'can_remove')).toBe(false);
  });

  it('資料夾本身的操作看上層：被分享的 art 不能改名，自己建立、在 art 裡的 ui 可以', () => {
    const checker = checkerFor([grant('art', 'contributor')]);
    expect(checker.check({ type: 'fileFolder', id: 'art' }, 'can_rename')).toBe(false);
    expect(checker.check({ type: 'fileFolder', id: 'ui' }, 'can_rename')).toBe(true);
  });

  it('頂層資料夾的上層是根目錄：只有全域 file:update 能改名別人的頂層資料夾', () => {
    expect(
      checkerFor([globalKey('file:update')]).check(
        { type: 'fileFolder', id: 'secret' },
        'can_rename',
      ),
    ).toBe(true);
    expect(
      checkerFor([grant('secret', 'manager')]).check(
        { type: 'fileFolder', id: 'secret' },
        'can_rename',
      ),
    ).toBe(false);
  });

  it('依賴樹開啟時，全域 file:delete 帶來 file:update 與 file:read', () => {
    const checker = checkerFor([globalKey('file:delete')], true);
    expect([
      can(checker, 'delete', 'art'),
      can(checker, 'update', 'art'),
      can(checker, 'read', 'private'),
    ]).toEqual([true, true, true]);
  });

  it('等級蘊含的動作（反提權用）', () => {
    const actions = (level: string) =>
      [...impliedRelations(model(), 'fileFolder', level)]
        .filter((r) => /^can_(read|create|update|delete|share)$/.test(r))
        .toSorted();
    expect(actions('viewer')).toEqual(['can_read']);
    expect(actions('contributor')).toEqual(['can_create', 'can_read']);
    expect(actions('editor')).toEqual(['can_create', 'can_delete', 'can_read', 'can_update']);
    expect(actions('manager')).toEqual([
      'can_create',
      'can_delete',
      'can_read',
      'can_share',
      'can_update',
    ]);
  });
});
