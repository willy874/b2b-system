import { renderRoute } from '@b2b-system/web-core/testing';
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { featureStore } from '@/core/feature/store';
import { PermissionKey, resetPagePermissionRegistry } from '@/core/permission';
import type { FileFolder } from '@/shared/api-sdk';
import { initTestI18n } from '@/test/i18n';

import { registerFilePagePermissions, Routes } from '../../..';
import fileZhTW from '../../../locales/zh_TW.json';
import { DEFAULT_FILE_VIEW_PREFERENCE, useFileViewPreferenceStore } from '../../../preference';

const { fetchFolders, fetchFiles, fetchTags, fetchPolicy } = vi.hoisted(() => ({
  fetchFolders: vi.fn(),
  fetchFiles: vi.fn(),
  fetchTags: vi.fn(),
  fetchPolicy: vi.fn(),
}));
vi.mock('@/apis/file/get-file-folder-list/fetcher', () => ({
  fetchFileFolderListQuery: fetchFolders,
}));
vi.mock('@/apis/file/get-file-list/fetcher', () => ({ fetchFileListQuery: fetchFiles }));
vi.mock('@/apis/tag/get-tag-list/fetcher', () => ({ fetchTagListQuery: fetchTags }));
vi.mock('@/apis/file/get-upload-policy/fetcher', () => ({
  fetchFileUploadPolicyQuery: fetchPolicy,
}));

const CAN_ALL = {
  canRead: true,
  canCreate: true,
  canUpdate: true,
  canDelete: true,
  canShare: true,
};

const folder = (id: string, name: string, parentId: string | null = null): FileFolder => ({
  id,
  name,
  parentId,
  kind: 'normal',
  inheritGrants: true,
  hasPendingAccessRequest: false,
  capabilities: CAN_ALL,
  tags: [],
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
});

const file = (id: string, name: string, folderId: string | null) => ({
  id,
  name,
  contentType: 'text/plain',
  size: 1,
  folderId,
  url: null,
  downloadUrl: null,
  thumbnailUrl: null,
  image: null,
  version: 1,
  uploader: null,
  capabilities: { canUpdate: true, canDelete: true },
  tags: [],
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
});

// 網址上的資料夾是 uuid（routes/model.ts）
const HOME = '00000000-0000-4000-8000-0000000000f1';
const ART = '00000000-0000-4000-8000-0000000000f2';

const READER = [PermissionKey['file:read']];
const routes = [Routes.FileListRoute];

beforeAll(() => initTestI18n(fileZhTW));

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  resetPagePermissionRegistry();
  registerFilePagePermissions();
  featureStore.setState({ resolved: true, statuses: new Map([['file', 'ready']]) });
  useFileViewPreferenceStore.setState({ ...DEFAULT_FILE_VIEW_PREFERENCE });
  fetchFolders.mockResolvedValue({
    items: [folder(HOME, '我的檔案'), folder(ART, '設計稿', HOME)],
    rootCapabilities: { canCreate: true },
    personalFolderId: HOME,
  });
  fetchFiles.mockResolvedValue({
    items: [file('a', 'readme.txt', HOME), file('b', 'notes.txt', HOME)],
    pagination: { offset: 0, limit: 60, total: 2 },
    nextCursor: null,
    prevCursor: null,
  });
  fetchTags.mockResolvedValue({ items: [] });
  fetchPolicy.mockResolvedValue({
    maxSize: 100 * 1024 * 1024,
    multipartThreshold: 16 * 1024 * 1024,
    partSize: 8 * 1024 * 1024,
    thumbnailMaxSize: 1024 * 1024,
    thumbnailContentTypes: ['image/png'],
    storageQuota: 0,
    storageUsed: 0,
  });
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
});

afterEach(() => {
  featureStore.setState({ resolved: false, statuses: new Map() });
  vi.restoreAllMocks();
});

describe('檔案管理器頁（docs/architecture/frontend/12-file-manager.md）', () => {
  it('渲染整個頁面：進入時導到自己的個人資料夾，列出它的子資料夾與檔案、麵包屑與總數', async () => {
    const { router } = renderRoute(routes, '/file', READER);

    expect(
      await screen.findByTestId('file-manager-page', undefined, { timeout: 5000 }),
    ).toBeInTheDocument();
    // 預設位置是個人資料夾（docs/architecture/iam/06-resource-grants.md §12）
    await waitFor(() => expect(router.state.location.search).toMatchObject({ folder: HOME }));
    await waitFor(() =>
      expect(fetchFiles).toHaveBeenCalledWith(
        expect.objectContaining({ params: expect.objectContaining({ folderId: HOME }) }),
      ),
    );

    const browser = screen.getByTestId('file-browser');
    expect(await within(browser).findByText('readme.txt')).toBeInTheDocument();
    expect(within(browser).getByText('notes.txt')).toBeInTheDocument();
    expect(within(browser).getByText('設計稿')).toBeInTheDocument();
    // 麵包屑另有一份量寬度用的隱藏副本：同一個名稱會出現兩次
    expect(
      within(screen.getByTestId('file-breadcrumb')).getAllByText('我的檔案').length,
    ).toBeGreaterThan(0);
    expect(screen.getByTestId('file-folder-tree')).toBeInTheDocument();
    expect(screen.getByTestId('file-total')).toHaveTextContent('2');
  });

  it('資料夾裡沒有任何東西 → 顯示空狀態', async () => {
    fetchFolders.mockResolvedValue({
      items: [folder(HOME, '我的檔案')],
      rootCapabilities: { canCreate: true },
      personalFolderId: HOME,
    });
    fetchFiles.mockResolvedValue({
      items: [],
      pagination: { offset: 0, limit: 60, total: 0 },
      nextCursor: null,
      prevCursor: null,
    });
    renderRoute(routes, `/file?folder=${HOME}`, READER);

    expect(
      await screen.findByTestId('file-empty', undefined, { timeout: 5000 }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('file-item')).toBeNull();
  });
});
