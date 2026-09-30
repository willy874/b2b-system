import { afterEach, describe, expect, it } from 'vitest';

import { AUTH_PROFILE_QUERY_KEY } from '@/apis/auth/get-profile/query';
import { getFileListQueryOptions } from '@/apis/file/get-file-list/query';
import { queryClient } from '@/core/cache';
import type { FileListPage, Profile } from '@/shared/api-sdk';

import { applyResourceChanges, resolveResourceChanges, Resource } from '../resources';
import type { ResourceChangeEvent } from '../resources';

const SELF_ID = 'self-user';
const SELF_ROLE = 'self-role';

function signInAs() {
  queryClient.setQueryData<Profile>([AUTH_PROFILE_QUERY_KEY], {
    user: { id: SELF_ID } as Profile['user'],
    roles: [{ id: SELF_ROLE, slug: 'admin', name: 'Admin', isSystem: true }],
    permissions: [],
  });
}

/** 某個資料夾（undefined = 不分資料夾）的檔案列表 query key。 */
const fileListIn = (folderId: string | undefined) =>
  getFileListQueryOptions({ params: { folderId, offset: 0, limit: 60 } }).queryKey;

const EMPTY_FILE_PAGE: FileListPage = {
  items: [],
  pagination: { offset: 0, limit: 60, total: 0 },
  nextCursor: null,
};

const keysOf = (...changes: ResourceChangeEvent[]) =>
  resolveResourceChanges(changes)
    .map((target) => [target.action, ...target.queryKey].join(':'))
    .toSorted();

describe('資源依賴圖（docs/architecture/frontend/05-data-layer.md §6.2）', () => {
  afterEach(() => queryClient.clear());

  it('審核一筆請求：審批列表與該筆詳情，不碰其他資源', () => {
    expect(keysOf({ resource: Resource.APPROVAL, kind: 'update', id: 'a1' })).toEqual([
      'invalidate:APPROVAL_DETAIL_QUERY_KEY:a1',
      'invalidate:APPROVAL_LIST_QUERY_KEY',
      'invalidate:AUDIT_LOG_LIST_QUERY_KEY',
    ]);
  });

  it('建立角色：角色列表與選項，不碰任何角色詳情', () => {
    expect(keysOf({ resource: Resource.ROLE, kind: 'create' })).toEqual([
      'invalidate:AUDIT_LOG_LIST_QUERY_KEY',
      'invalidate:ROLE_LIST_QUERY_KEY',
      'invalidate:ROLE_OPTIONS_QUERY_KEY',
    ]);
  });

  it('刪除角色：移除該角色的單筆快取，並失效嵌入角色摘要的使用者', () => {
    signInAs();
    const keys = keysOf({ resource: Resource.ROLE, kind: 'delete', id: 'r1' });
    expect(keys).toContain('remove:ROLE_DETAIL_QUERY_KEY:r1');
    expect(keys).toContain('remove:ROLE_USERS_QUERY_KEY:r1');
    expect(keys).toContain('invalidate:USER_DETAIL_QUERY_KEY');
    // 自己沒有這個角色
    expect(keys).not.toContain('invalidate:AUTH_PROFILE_QUERY_KEY');
  });

  it('變更角色權限：只影響該角色；自己持有該角色時才失效 profile', () => {
    signInAs();
    const other = keysOf({ resource: Resource.ROLE_PERMISSION, kind: 'update', id: 'r1' });
    expect(other).toContain('invalidate:ROLE_PERMISSIONS_QUERY_KEY:r1');
    expect(other).not.toContain('invalidate:ROLE_PERMISSIONS_QUERY_KEY');
    expect(other).not.toContain('invalidate:AUTH_PROFILE_QUERY_KEY');
    expect(other.some((key) => key.includes('USER_'))).toBe(false);

    const mine = keysOf({ resource: Resource.ROLE_PERMISSION, kind: 'update', id: SELF_ROLE });
    expect(mine).toContain('invalidate:AUTH_PROFILE_QUERY_KEY');
  });

  it('指派使用者角色：該使用者 ＋ 新舊角色，不擴散到其他使用者或角色', () => {
    signInAs();
    const keys = keysOf({
      resource: Resource.USER_ROLE,
      kind: 'update',
      id: 'u1',
      refs: { role: ['r1', 'r2'] },
    });
    expect(keys).toEqual([
      'invalidate:AUDIT_LOG_LIST_QUERY_KEY',
      'invalidate:ROLE_DETAIL_QUERY_KEY:r1',
      'invalidate:ROLE_DETAIL_QUERY_KEY:r2',
      'invalidate:ROLE_LIST_QUERY_KEY',
      'invalidate:ROLE_OPTIONS_QUERY_KEY',
      'invalidate:ROLE_PERMISSIONS_QUERY_KEY:r1',
      'invalidate:ROLE_PERMISSIONS_QUERY_KEY:r2',
      'invalidate:ROLE_USERS_QUERY_KEY:r1',
      'invalidate:ROLE_USERS_QUERY_KEY:r2',
      'invalidate:USER_DETAIL_QUERY_KEY:u1',
      'invalidate:USER_LIST_QUERY_KEY',
      'invalidate:USER_ROLES_QUERY_KEY:u1',
    ]);
  });

  it('指派角色給自己：一併失效 profile', () => {
    signInAs();
    const keys = keysOf({ resource: Resource.USER_ROLE, kind: 'update', id: SELF_ID });
    expect(keys).toContain('invalidate:AUTH_PROFILE_QUERY_KEY');
  });

  it('建立不帶角色的使用者：角色端完全不受影響', () => {
    expect(keysOf({ resource: Resource.USER, kind: 'create', refs: { role: [] } })).toEqual([
      'invalidate:AUDIT_LOG_LIST_QUERY_KEY',
      'invalidate:USER_LIST_QUERY_KEY',
    ]);
  });

  it('改自己的 profile：等同 user(self) 更新，profile 跟著失效', () => {
    signInAs();
    const keys = keysOf({ resource: Resource.USER, kind: 'update', id: SELF_ID });
    expect(keys).toContain('invalidate:AUTH_PROFILE_QUERY_KEY');
    expect(keys).toContain('invalidate:USER_DETAIL_QUERY_KEY:' + SELF_ID);
  });

  it('重設密碼：畫面資料不變，只失效稽核列表', () => {
    expect(keysOf({ resource: Resource.USER_CREDENTIAL, kind: 'update', id: 'u1' })).toEqual([
      'invalidate:AUDIT_LOG_LIST_QUERY_KEY',
    ]);
  });

  it('任何寫入都失效稽核列表，但不碰既有稽核詳情', () => {
    const keys = keysOf({ resource: Resource.ROLE, kind: 'update', id: 'r1' });
    expect(keys).toContain('invalidate:AUDIT_LOG_LIST_QUERY_KEY');
    expect(keys.some((key) => key.includes('AUDIT_LOG_DETAIL'))).toBe(false);
  });

  describe('檔案的推播只重抓相關資料夾的列表', () => {
    it('帶了所在的資料夾：只失效那個資料夾與不分資料夾的列表', () => {
      const keys = keysOf({
        resource: Resource.FILE,
        kind: 'create',
        id: 'f1',
        refs: { fileFolder: ['folder-a'] },
      });
      expect(keys).toContain('invalidate:FILE_LIST_QUERY_KEY:folder-a');
      expect(keys).toContain('invalidate:FILE_LIST_QUERY_KEY:*');
      expect(keys).toContain('invalidate:FILE_INFINITE_LIST_QUERY_KEY:folder-a');
      expect(keys).not.toContain('invalidate:FILE_LIST_QUERY_KEY');
    });

    it('套用到快取：其他資料夾的列表不被標成 stale', () => {
      for (const folderId of ['folder-a', 'folder-b', undefined]) {
        queryClient.setQueryData(fileListIn(folderId), EMPTY_FILE_PAGE);
      }
      applyResourceChanges(
        [{ resource: Resource.FILE, kind: 'update', id: 'f1', refs: { fileFolder: ['folder-a'] } }],
        { refetch: false },
      );
      expect(queryClient.getQueryState(fileListIn('folder-a'))?.isInvalidated).toBe(true);
      expect(queryClient.getQueryState(fileListIn(undefined))?.isInvalidated).toBe(true);
      expect(queryClient.getQueryState(fileListIn('folder-b'))?.isInvalidated).toBe(false);
    });

    it('沒帶資料夾（批次移動、遞迴刪除）：所有檔案列表都失效', () => {
      const keys = keysOf({ resource: Resource.FILE, kind: 'update', id: '*' });
      expect(keys).toContain('invalidate:FILE_LIST_QUERY_KEY');
      expect(keys).toContain('invalidate:FILE_INFINITE_LIST_QUERY_KEY');
    });
  });
});
