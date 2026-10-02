import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { featureStore } from '@/core/feature';
import type { PermissionKey } from '@/core/permission';
import { resetPagePermissionRegistry } from '@/core/permission';
import { initTestI18n } from '@/test/i18n';
import { renderRoute } from '@/test/renderRoute';

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
});
