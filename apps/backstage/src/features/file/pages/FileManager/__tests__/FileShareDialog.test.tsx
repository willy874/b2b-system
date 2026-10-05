import { renderWithPermissions } from '@b2b-system/web-core/testing';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { FileFolderGrantList } from '@/shared/api-sdk';

import { FileShareDialog } from '../components/FileShareDialog';

const { fetchGrants, fetchSubjects, setGrant, deleteGrant, setInheritance, fetchExplain } =
  vi.hoisted(() => ({
    fetchExplain: vi.fn(),
    fetchGrants: vi.fn(),
    fetchSubjects: vi.fn(),
    setGrant: vi.fn(),
    deleteGrant: vi.fn(),
    setInheritance: vi.fn(),
  }));
vi.mock('@/apis/file/update-file-folder-access/mutation', () => ({
  getFileFolderAccessUpdateMutationOptions: () => ({ mutationFn: setInheritance }),
}));
vi.mock('@/apis/file/get-file-folder-grants/query', async (importOriginal) => ({
  // 常數（query key）照舊：apis/resources.ts 依賴它
  ...(await importOriginal<object>()),
  getFileFolderGrantListQueryOptions: (folderId: string) => ({
    queryKey: ['FILE_FOLDER_GRANT_LIST_QUERY_KEY', folderId],
    queryFn: () => fetchGrants(folderId),
  }),
}));
vi.mock('@/apis/file/get-file-grant-subjects/query', () => ({
  getFileGrantSubjectListQueryOptions: (params: { keyword?: string }) => ({
    queryKey: ['FILE_GRANT_SUBJECT_LIST_QUERY_KEY', params.keyword ?? ''],
    queryFn: () => fetchSubjects(params),
  }),
}));
vi.mock('@/apis/file/get-file-folder-explain/fetcher', () => ({
  fetchFileFolderExplainQuery: fetchExplain,
}));
vi.mock('@/apis/file/set-file-folder-grant/mutation', () => ({
  getFileFolderGrantSetMutationOptions: () => ({ mutationFn: setGrant }),
}));
vi.mock('@/apis/file/delete-file-folder-grant/mutation', () => ({
  getFileFolderGrantDeleteMutationOptions: () => ({ mutationFn: deleteGrant }),
}));

const ART_TEAM = '11111111-1111-4111-8111-111111111111';
const MEMBER = '22222222-2222-4222-8222-222222222222';

function grants(overrides: Partial<FileFolderGrantList> = {}): FileFolderGrantList {
  return {
    folderId: 'ui',
    inheritGrants: true,
    assignableLevels: ['viewer', 'contributor', 'editor', 'manager'],
    items: [
      {
        subjectType: 'role',
        subjectId: ART_TEAM,
        subjectName: '美術組',
        level: 'editor',
        expiresAt: null,
        isExpired: false,
        grantedAt: '2026-09-29T00:00:00.000Z',
        source: null,
      },
      {
        subjectType: 'role',
        subjectId: MEMBER,
        subjectName: '一般成員',
        level: 'viewer',
        expiresAt: null,
        isExpired: false,
        grantedAt: '2026-09-29T00:00:00.000Z',
        source: { folderId: 'art', folderName: '美術' },
      },
    ],
    ...overrides,
  };
}

function renderDialog() {
  const onClose = vi.fn();
  renderWithPermissions(<FileShareDialog folder={{ id: 'ui', name: 'ui' }} onClose={onClose} />);
  return { onClose };
}

const rowOf = async (subjectId: string) =>
  (await screen.findAllByTestId('file-share-grant')).find(
    (row) => row.getAttribute('data-value') === subjectId,
  );

beforeEach(() => {
  fetchGrants.mockReset();
  fetchSubjects.mockReset().mockResolvedValue({ items: [] });
  fetchExplain.mockReset();
  setGrant.mockReset().mockResolvedValue(grants());
  deleteGrant.mockReset().mockResolvedValue(undefined);
  setInheritance.mockReset().mockResolvedValue(grants());
});

describe('FileShareDialog（docs/architecture/frontend/12-file-manager.md §13）', () => {
  it('直接授權可以變更與移除；繼承來的只顯示來源與等級', async () => {
    fetchGrants.mockResolvedValue(grants());
    renderDialog();

    const direct = await rowOf(ART_TEAM);
    expect(direct).toBeDefined();
    expect(within(direct as HTMLElement).getByTestId('file-share-grant-remove')).toBeVisible();

    const inherited = await rowOf(MEMBER);
    expect(inherited).toHaveAttribute('data-source', 'art');
    expect(within(inherited as HTMLElement).queryByTestId('file-share-grant-remove')).toBeNull();
  });

  it('移除送出資料夾、對象種類與 id', async () => {
    fetchGrants.mockResolvedValue(grants());
    renderDialog();
    const direct = await rowOf(ART_TEAM);
    fireEvent.click(within(direct as HTMLElement).getByTestId('file-share-grant-remove'));
    await waitFor(() =>
      expect(deleteGrant.mock.calls[0]?.[0]).toEqual({
        params: { folderId: 'ui', subjectType: 'role', subjectId: ART_TEAM },
      }),
    );
  });

  it('授予不起的等級（反提權）：不顯示新增列，高於自己的授權唯讀', async () => {
    fetchGrants.mockResolvedValue(grants({ assignableLevels: ['viewer'] }));
    renderDialog();
    const direct = await rowOf(ART_TEAM);
    expect(within(direct as HTMLElement).queryByTestId('file-share-grant-remove')).toBeNull();
    expect(screen.getByTestId('file-share-subject')).toBeVisible();
  });

  it('沒有任何授權的等級可以給 → 不顯示新增列', async () => {
    fetchGrants.mockResolvedValue(grants({ assignableLevels: [], items: [] }));
    renderDialog();
    expect(await screen.findByTestId('file-share-empty')).toBeVisible();
    expect(screen.queryByTestId('file-share-subject')).toBeNull();
  });

  it('新增鈕在選好對象之前不可按', async () => {
    fetchGrants.mockResolvedValue(grants());
    renderDialog();
    expect(await screen.findByTestId('file-share-add')).toBeDisabled();
  });

  it('關閉「繼承上層資料夾的授權」→ 送出 inheritGrants: false', async () => {
    fetchGrants.mockResolvedValue(grants());
    renderDialog();
    fireEvent.click(await screen.findByTestId('file-share-inherit'));
    await waitFor(() =>
      expect(setInheritance.mock.calls[0]?.[0]).toEqual({
        params: { folderId: 'ui', body: { inheritGrants: false } },
      }),
    );
  });

  it('過期的授權標示出來，仍可移除', async () => {
    const base = grants();
    const [direct] = base.items;
    if (!direct) throw new Error('fixture');
    fetchGrants.mockResolvedValue({
      ...base,
      items: [{ ...direct, expiresAt: '2026-01-01T00:00:00.000Z', isExpired: true }],
    });
    renderDialog();
    const row = await rowOf(ART_TEAM);
    expect(row).toHaveAttribute('data-expired', 'true');
    expect(within(row as HTMLElement).getByTestId('file-share-grant-remove')).toBeVisible();
  });

  it('「所有人」的授權：列出並可移除（名稱由語系提供）', async () => {
    const base = grants();
    const [direct] = base.items;
    if (!direct) throw new Error('fixture');
    const everyone = '00000000-0000-0000-0000-000000000000';
    fetchGrants.mockResolvedValue({
      ...base,
      items: [{ ...direct, subjectType: 'everyone', subjectId: everyone, subjectName: '' }],
    });
    renderDialog();
    const row = await rowOf(everyone);
    expect(row).toHaveAttribute('data-subject-type', 'everyone');
    fireEvent.click(within(row as HTMLElement).getByTestId('file-share-grant-remove'));
    await waitFor(() =>
      expect(deleteGrant.mock.calls[0]?.[0]).toEqual({
        params: { folderId: 'ui', subjectType: 'everyone', subjectId: everyone },
      }),
    );
  });

  describe('檢查存取（docs/rbac/01-domain-model.md §9 G4b）', () => {
    it('沒有 authz:explain → 不顯示', async () => {
      fetchGrants.mockResolvedValue(grants());
      renderDialog();
      await screen.findByTestId('file-share-dialog');
      expect(screen.queryByTestId('file-access-explain')).not.toBeInTheDocument();
    });

    it('有 authz:explain → 挑一位使用者，列出每個動作能不能做與路徑', async () => {
      fetchGrants.mockResolvedValue(grants());
      fetchSubjects.mockResolvedValue({
        items: [{ subjectType: 'user', id: 'alice', name: 'Alice', hint: null }],
      });
      fetchExplain.mockResolvedValue({
        folderId: 'ui',
        userId: 'alice',
        actions: [
          {
            action: 'read',
            allowed: true,
            path: [
              { type: 'user', id: 'alice', relation: '', name: 'Alice', hidden: false },
              { type: 'group', id: null, relation: 'member', name: null, hidden: true },
              { type: 'fileFolder', id: 'ui', relation: 'can_read', name: 'ui', hidden: false },
            ],
          },
          { action: 'delete', allowed: false, path: null },
        ],
      });
      renderWithPermissions(
        <FileShareDialog folder={{ id: 'ui', name: 'ui' }} onClose={vi.fn()} />,
        ['authz:explain'] as never,
      );
      const section = await screen.findByTestId('file-access-explain');
      fireEvent.click(within(section).getByTestId('file-access-explain-user'));
      fireEvent.click(await screen.findByText('Alice'));

      const actions = await within(section).findAllByTestId('file-access-explain-action');
      expect(
        actions.map((item) => [item.getAttribute('data-value'), item.getAttribute('data-allowed')]),
      ).toEqual([
        ['read', 'true'],
        ['delete', 'false'],
      ]);
      expect(fetchExplain.mock.calls[0]![0].params).toEqual({ folderId: 'ui', userId: 'alice' });
      expect(within(actions[0]!).getAllByTestId('explain-node')).toHaveLength(3);
    });
  });
});
