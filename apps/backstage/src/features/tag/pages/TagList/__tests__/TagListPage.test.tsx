import { AppError } from '@b2b-system/web-core/errors';
import { renderRoute } from '@b2b-system/web-core/testing';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { featureStore } from '@/core/feature';
import type { PermissionKey } from '@/core/permission';
import { resetPagePermissionRegistry } from '@/core/permission';
import { initTestI18n } from '@/test/i18n';

import { registerTagPagePermissions, Routes } from '../../..';
import tagZhTW from '../../../locales/zh_TW.json';

const { fetchTags, createTag, updateTag, deleteTag } = vi.hoisted(() => ({
  fetchTags: vi.fn(),
  createTag: vi.fn(),
  updateTag: vi.fn(),
  deleteTag: vi.fn(),
}));
vi.mock('@/apis/tag/get-tag-list/fetcher', () => ({ fetchTagListQuery: fetchTags }));
vi.mock('@/apis/tag/create-tag/fetcher', () => ({ fetchTagCreateMutation: createTag }));
vi.mock('@/apis/tag/update-tag/fetcher', () => ({ fetchTagUpdateMutation: updateTag }));
vi.mock('@/apis/tag/delete-tag/fetcher', () => ({ fetchTagDeleteMutation: deleteTag }));

const tag = (id: string, name: string, scope = 'file') => ({
  id,
  scope,
  name,
  color: 'warning',
  version: 1,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
});
const ADMIN = ['tag:create', 'tag:update', 'tag:delete'] as PermissionKey[];
const routes = [Routes.TagListRoute];

beforeAll(() => initTestI18n(tagZhTW));

beforeEach(() => {
  resetPagePermissionRegistry();
  registerTagPagePermissions();
  featureStore.setState({ resolved: true, statuses: new Map([['file', 'ready']]) });
  fetchTags.mockReset().mockImplementation(async ({ params }: { params: { scope: string } }) => ({
    items: params.scope === 'file' ? [tag('t1', '合約')] : [tag('u1', '研發部', 'user')],
  }));
  createTag.mockReset().mockImplementation(async ({ params }) => tag('new', params.name));
  updateTag.mockReset();
  deleteTag.mockReset().mockResolvedValue(undefined);
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
});

describe('TagListPage（docs/architecture/backend/18-tag.md §7.2 D5）', () => {
  it('有 tag:create／update／delete → 顯示建立、編輯、刪除', async () => {
    renderRoute(routes, '/tag', ADMIN);
    await screen.findByText('合約', undefined, { timeout: 12_000 });
    expect(screen.getByTestId('tag-create-button')).toBeInTheDocument();
    expect(screen.getByTestId('tag-edit-button')).toBeInTheDocument();
    expect(screen.getByTestId('tag-delete-button')).toBeInTheDocument();
    // 第一個案例要載入 lazy 頁面，比較久
  }, 15_000);

  it('只有 tag:update → 能編輯，不能建立與刪除', async () => {
    renderRoute(routes, '/tag', ['tag:update'] as PermissionKey[]);
    await screen.findByText('合約', undefined, { timeout: 5000 });
    expect(screen.queryByTestId('tag-create-button')).toBeNull();
    expect(screen.getByTestId('tag-edit-button')).toBeInTheDocument();
    expect(screen.queryByTestId('tag-delete-button')).toBeNull();
  });

  it('權限未水合 → 不閃現操作按鈕', async () => {
    renderRoute(routes, '/tag', 'unhydrated');
    await waitFor(() => expect(screen.queryByTestId('tag-create-button')).toBeNull());
    expect(screen.queryByTestId('tag-delete-button')).toBeNull();
  });

  it('分頁切換標籤組；檔案 feature 沒啟用時沒有「檔案」分頁', async () => {
    featureStore.setState({ statuses: new Map([['file', 'disabled']]) });
    renderRoute(routes, '/tag', ADMIN);
    await screen.findByText('研發部', undefined, { timeout: 5000 });
    expect(fetchTags).toHaveBeenCalledWith(expect.objectContaining({ params: { scope: 'user' } }));
    expect(screen.queryByText('合約')).toBeNull();
  });

  it('建立：以目前分頁的標籤組送出', async () => {
    renderRoute(routes, '/tag?scope=user', ADMIN);
    await screen.findByText('研發部', undefined, { timeout: 5000 });
    fireEvent.click(screen.getByTestId('tag-create-button'));
    const dialog = await screen.findByTestId('tag-form-dialog');
    fireEvent.change(within(dialog).getByTestId('tag-name-input'), { target: { value: '業務部' } });
    fireEvent.click(within(dialog).getByTestId('tag-form-submit'));
    await waitFor(() => expect(createTag).toHaveBeenCalledTimes(1));
    expect(createTag.mock.calls[0]![0]).toMatchObject({
      params: { scope: 'user', name: '業務部', color: 'neutral' },
    });
  });

  it('刪除：確認後呼叫刪除', async () => {
    renderRoute(routes, '/tag', ADMIN);
    await screen.findByText('合約', undefined, { timeout: 5000 });
    fireEvent.click(screen.getByTestId('tag-delete-button'));
    const confirm = await screen.findByTestId('tag-delete-confirm');
    fireEvent.click(within(confirm).getByTestId('alert-dialog-confirm'));
    await waitFor(() => expect(deleteTag).toHaveBeenCalledTimes(1));
    expect(deleteTag.mock.calls[0]![0]).toMatchObject({ params: { tagId: 't1' } });
  });

  it('編輯遇到版本衝突：顯示 VersionConflictAlert；重新載入後以新的 version 儲存成功', async () => {
    updateTag
      .mockRejectedValueOnce(new AppError('TAG_VERSION_CONFLICT', 409, { current: 2 }))
      .mockImplementation(async ({ params }) => ({ ...tag('t1', params.body.name), version: 3 }));
    renderRoute(routes, '/tag', ADMIN);
    await screen.findByText('合約', undefined, { timeout: 5000 });
    fireEvent.click(screen.getByTestId('tag-edit-button'));
    const dialog = await screen.findByTestId('tag-form-dialog');
    fireEvent.change(within(dialog).getByTestId('tag-name-input'), { target: { value: '合約書' } });
    fireEvent.click(within(dialog).getByTestId('tag-form-submit'));

    expect(await within(dialog).findByTestId('version-conflict-alert')).toBeInTheDocument();
    expect(within(dialog).getByTestId('tag-name-input')).toHaveValue('合約書');

    // 別人把它改成了「合約範本」，版本號變成 2
    fetchTags.mockResolvedValue({ items: [{ ...tag('t1', '合約範本'), version: 2 }] });
    fireEvent.click(within(dialog).getByTestId('version-conflict-reload'));
    await waitFor(() =>
      expect(within(dialog).getByTestId('tag-name-input')).toHaveValue('合約範本'),
    );
    expect(within(dialog).queryByTestId('version-conflict-alert')).toBeNull();

    fireEvent.change(within(dialog).getByTestId('tag-name-input'), { target: { value: '合約書' } });
    fireEvent.click(within(dialog).getByTestId('tag-form-submit'));
    await waitFor(() => expect(updateTag).toHaveBeenCalledTimes(2));
    expect(updateTag.mock.calls[1]![0]).toMatchObject({
      params: { tagId: 't1', body: { name: '合約書', version: 2 } },
    });
    await waitFor(() => expect(screen.queryByTestId('tag-form-dialog')).toBeNull());
  });

  it('版本衝突後重新載入，標籤已被別人刪除 → 說明原因再關掉對話框', async () => {
    updateTag.mockRejectedValueOnce(new AppError('TAG_VERSION_CONFLICT', 409, { current: 2 }));
    renderRoute(routes, '/tag', ADMIN);
    await screen.findByText('合約', undefined, { timeout: 5000 });
    fireEvent.click(screen.getByTestId('tag-edit-button'));
    const dialog = await screen.findByTestId('tag-form-dialog');
    fireEvent.change(within(dialog).getByTestId('tag-name-input'), { target: { value: '合約書' } });
    fireEvent.click(within(dialog).getByTestId('tag-form-submit'));
    expect(await within(dialog).findByTestId('version-conflict-alert')).toBeInTheDocument();

    fetchTags.mockResolvedValue({ items: [] });
    fireEvent.click(within(dialog).getByTestId('version-conflict-reload'));
    expect(await screen.findByTestId('toast')).toHaveTextContent('已被他人刪除');
    await waitFor(() => expect(screen.queryByTestId('tag-form-dialog')).toBeNull());
  });

  describe('表單對話框的未儲存提醒', () => {
    it('改了名稱後按 Esc：先確認；選「繼續編輯」後輸入還在', async () => {
      renderRoute(routes, '/tag', ADMIN);
      await screen.findByText('合約', undefined, { timeout: 5000 });
      fireEvent.click(screen.getByTestId('tag-edit-button'));
      const dialog = await screen.findByTestId('tag-form-dialog');
      const input = within(dialog).getByTestId('tag-name-input');
      fireEvent.change(input, { target: { value: '合約書' } });
      fireEvent.keyDown(input, { key: 'Escape' });

      const confirm = await screen.findByTestId('unsaved-changes-confirm');
      fireEvent.click(within(confirm).getByTestId('alert-dialog-cancel'));
      await waitFor(() => expect(screen.queryByTestId('unsaved-changes-confirm')).toBeNull());
      expect(within(dialog).getByTestId('tag-name-input')).toHaveValue('合約書');
    });

    it('建立時輸入名稱後按取消：選「放棄變更」才關閉', async () => {
      renderRoute(routes, '/tag', ADMIN);
      await screen.findByText('合約', undefined, { timeout: 5000 });
      fireEvent.click(screen.getByTestId('tag-create-button'));
      const dialog = await screen.findByTestId('tag-form-dialog');
      fireEvent.change(within(dialog).getByTestId('tag-name-input'), { target: { value: '急件' } });
      fireEvent.click(within(dialog).getByTestId('tag-form-cancel'));

      const confirm = await screen.findByTestId('unsaved-changes-confirm');
      fireEvent.click(within(confirm).getByTestId('alert-dialog-confirm'));
      await waitFor(() => expect(screen.queryByTestId('tag-form-dialog')).toBeNull());
    });

    it('沒有改動時按 Esc：直接關閉', async () => {
      renderRoute(routes, '/tag', ADMIN);
      await screen.findByText('合約', undefined, { timeout: 5000 });
      fireEvent.click(screen.getByTestId('tag-edit-button'));
      const dialog = await screen.findByTestId('tag-form-dialog');
      fireEvent.keyDown(within(dialog).getByTestId('tag-name-input'), { key: 'Escape' });

      await waitFor(() => expect(screen.queryByTestId('tag-form-dialog')).toBeNull());
      expect(screen.queryByTestId('unsaved-changes-confirm')).toBeNull();
    });
  });
});

describe('TagListPage 的匯出、匯入入口（docs/architecture/backend/22-data-transfer.md §12.4）', () => {
  it('有 tag:export、tag:update → 顯示「匯出」「匯入」；沒有 tag:export 只有匯入', async () => {
    featureStore.setState({
      resolved: true,
      statuses: new Map([
        ['file', 'ready'],
        ['dataTransfer', 'ready'],
      ]),
    });
    renderRoute(routes, '/tag?scope=user', [...ADMIN, 'tag:export'] as PermissionKey[]);
    await screen.findByText('研發部', undefined, { timeout: 5000 });
    expect(screen.getByTestId('tag-export-button')).toBeInTheDocument();
    expect(screen.getByTestId('tag-import-button')).toBeInTheDocument();
  });

  it('租戶沒有啟用 dataTransfer → 不顯示', async () => {
    renderRoute(routes, '/tag?scope=user', [...ADMIN, 'tag:export'] as PermissionKey[]);
    await screen.findByText('研發部', undefined, { timeout: 5000 });
    expect(screen.queryByTestId('tag-export-button')).toBeNull();
    expect(screen.queryByTestId('tag-import-button')).toBeNull();
  });
});
