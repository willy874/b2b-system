import { AppError } from '@b2b-system/web-core/errors';
import { AllProviders } from '@b2b-system/web-core/testing';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Comment, CommentPage } from '@/shared/api-sdk';
import { initTestI18n } from '@/test/i18n';

import zhTW from '../../locales/zh_TW.json';
import { CommentPanel } from '../CommentPanel';

const api = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  mentionable: vi.fn(),
  watchState: vi.fn(),
  watch: vi.fn(),
  unwatch: vi.fn(),
}));
vi.mock('@/apis/comment/get-comment-list/fetcher', () => ({ fetchCommentListQuery: api.list }));
vi.mock('@/apis/comment/create-comment/fetcher', () => ({
  fetchCommentCreateMutation: api.create,
}));
vi.mock('@/apis/comment/update-comment/fetcher', () => ({
  fetchCommentUpdateMutation: api.update,
}));
vi.mock('@/apis/comment/delete-comment/fetcher', () => ({
  fetchCommentDeleteMutation: api.remove,
}));
vi.mock('@/apis/comment/get-mentionable-users/fetcher', () => ({
  fetchMentionableUsersQuery: api.mentionable,
}));
vi.mock('@/apis/watch/get-watch-state/fetcher', () => ({ fetchWatchStateQuery: api.watchState }));
vi.mock('@/apis/watch/watch-resource/fetcher', () => ({ fetchWatchMutation: api.watch }));
vi.mock('@/apis/watch/unwatch-resource/fetcher', () => ({ fetchUnwatchMutation: api.unwatch }));

const USER_ID = '11111111-1111-4111-8111-111111111111';
const ME = { id: 'me', displayName: '我', email: 'me@example.com' };
const OTHER = { id: 'other', displayName: '別人', email: 'other@example.com' };

function comment(overrides: Partial<Comment> = {}): Comment {
  return {
    id: 'c1',
    resourceType: 'user',
    resourceId: USER_ID,
    body: '請確認權限',
    author: ME,
    authorAvatar: null,
    mentions: [],
    version: 1,
    createdAt: '2026-10-08T00:00:00.000Z',
    editedAt: null,
    canEdit: true,
    canDelete: true,
    ...overrides,
  };
}

function page(items: Comment[], nextCursor: string | null = null): CommentPage {
  return { items, nextCursor };
}

beforeAll(async () => {
  await initTestI18n(zhTW);
});

beforeEach(() => {
  vi.clearAllMocks();
  api.list.mockResolvedValue(page([]));
  api.watchState.mockResolvedValue({ watching: false, watcherCount: 0 });
  api.mentionable.mockResolvedValue({ items: [OTHER] });
  api.create.mockResolvedValue(comment({ id: 'new' }));
  api.update.mockResolvedValue(comment({ version: 2 }));
  api.remove.mockResolvedValue(undefined);
  api.watch.mockResolvedValue({ watching: true, watcherCount: 1 });
  api.unwatch.mockResolvedValue({ watching: false, watcherCount: 0 });
});

function renderPanel() {
  render(
    <AllProviders>
      <CommentPanel resourceType="user" resourceId={USER_ID} />
    </AllProviders>,
  );
}

const target = { resourceType: 'user', resourceId: USER_ID };

describe('CommentPanel（docs/architecture/frontend/22-comment.md §3）', () => {
  it('沒有留言時顯示空狀態', async () => {
    renderPanel();
    expect(await screen.findByTestId('comment-empty')).toBeInTheDocument();
    expect(api.list.mock.calls[0]?.[0]).toMatchObject({
      params: { ...target, limit: 20, cursor: undefined },
    });
  });

  it('留言的作者有操作選單；別人的留言（不能改也不能刪）沒有', async () => {
    api.list.mockResolvedValue(
      page([
        comment({ id: 'mine' }),
        comment({ id: 'theirs', author: OTHER, canEdit: false, canDelete: false }),
      ]),
    );
    renderPanel();
    const items = await screen.findAllByTestId('comment-item');
    expect(within(items[0]!).getByTestId('comment-actions')).toBeInTheDocument();
    expect(within(items[1]!).queryByTestId('comment-actions')).not.toBeInTheDocument();
  });

  it('被提及的人與「已編輯」標示；作者被永久刪除時顯示「已刪除的使用者」', async () => {
    api.list.mockResolvedValue(
      page([
        comment({
          author: null,
          mentions: [OTHER],
          editedAt: '2026-10-08T01:00:00.000Z',
          canEdit: false,
          canDelete: false,
        }),
      ]),
    );
    renderPanel();
    expect(await screen.findByText('已刪除的使用者')).toBeInTheDocument();
    expect(screen.getByTestId('comment-mentions')).toHaveTextContent('@別人');
    expect(screen.getByTestId('comment-edited')).toBeInTheDocument();
  });

  it('送出新留言（去掉前後空白），成功後清空', async () => {
    renderPanel();
    await screen.findByTestId('comment-empty');
    const textarea = screen.getByTestId('comment-editor-body');
    expect(screen.getByTestId('comment-editor-submit')).toBeDisabled();
    fireEvent.change(textarea, { target: { value: '  你好  ' } });
    fireEvent.click(screen.getByTestId('comment-editor-submit'));
    await waitFor(() =>
      expect(api.create.mock.calls[0]?.[0]).toMatchObject({
        params: { ...target, body: '你好', mentionIds: [] },
      }),
    );
    await waitFor(() => expect(textarea).toHaveValue(''));
  });

  it('提及的人從候選挑選（後端已過濾成看得到資源的人），一起送出', async () => {
    renderPanel();
    await screen.findByTestId('comment-empty');
    fireEvent.change(screen.getByTestId('comment-editor-body'), { target: { value: '看一下' } });
    fireEvent.click(screen.getByTestId('comment-editor-mentions'));
    fireEvent.click(await screen.findByRole('option', { name: /別人/ }));
    expect(api.mentionable.mock.calls[0]?.[0]).toMatchObject({
      params: { ...target, keyword: '' },
    });
    fireEvent.keyDown(screen.getByTestId('comment-editor-body'), { key: 'Enter', metaKey: true });
    await waitFor(() =>
      expect(api.create.mock.calls[0]?.[0]).toMatchObject({
        params: { body: '看一下', mentionIds: ['other'] },
      }),
    );
  });

  it('送出失敗：錯誤顯示在編輯器（帶錯誤碼），內容保留', async () => {
    api.create.mockRejectedValue(
      new AppError('COMMENT_MENTION_INVALID', 422, { userIds: ['other'] }),
    );
    renderPanel();
    await screen.findByTestId('comment-empty');
    const textarea = screen.getByTestId('comment-editor-body');
    fireEvent.change(textarea, { target: { value: '看一下' } });
    fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true });
    const alert = await screen.findByRole('alert');
    await waitFor(() => expect(alert).toHaveAttribute('data-value', 'COMMENT_MENTION_INVALID'));
    expect(textarea).toHaveValue('看一下');
  });

  it('編輯自己的留言：帶 version 送出', async () => {
    api.list.mockResolvedValue(page([comment({ version: 3 })]));
    renderPanel();
    fireEvent.click(await screen.findByTestId('comment-actions'));
    fireEvent.click(await screen.findByRole('menuitem', { name: '編輯' }));
    const editor = await screen.findByTestId('comment-edit-editor');
    fireEvent.change(within(editor).getByTestId('comment-editor-body'), {
      target: { value: '改過了' },
    });
    fireEvent.click(within(editor).getByTestId('comment-editor-submit'));
    await waitFor(() =>
      expect(api.update.mock.calls[0]?.[0]).toMatchObject({
        params: { commentId: 'c1', body: '改過了', mentionIds: [], version: 3 },
      }),
    );
    await waitFor(() =>
      expect(screen.queryByTestId('comment-edit-editor')).not.toBeInTheDocument(),
    );
  });

  it('刪除：先確認再送出', async () => {
    api.list.mockResolvedValue(page([comment()]));
    renderPanel();
    fireEvent.click(await screen.findByTestId('comment-actions'));
    fireEvent.click(await screen.findByRole('menuitem', { name: '刪除' }));
    const dialog = await screen.findByTestId('comment-delete-confirm');
    expect(api.remove).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: '刪除' }));
    await waitFor(() =>
      expect(api.remove.mock.calls[0]?.[0]).toMatchObject({ params: { commentId: 'c1' } }),
    );
  });

  it('還有較舊的留言時可以載入下一頁', async () => {
    api.list
      .mockResolvedValueOnce(page([comment({ id: 'new' })], 'cursor-1'))
      .mockResolvedValueOnce(page([comment({ id: 'old' })]));
    renderPanel();
    fireEvent.click(await screen.findByTestId('comment-load-more'));
    await waitFor(() => expect(screen.getAllByTestId('comment-item')).toHaveLength(2));
    expect(api.list.mock.calls[1]?.[0]).toMatchObject({ params: { cursor: 'cursor-1' } });
    expect(screen.queryByTestId('comment-load-more')).not.toBeInTheDocument();
  });

  it('關注與取消關注', async () => {
    renderPanel();
    const button = await screen.findByTestId('comment-watch-button');
    await waitFor(() => expect(button).toHaveAttribute('data-value', 'idle'));
    fireEvent.click(button);
    await waitFor(() => expect(api.watch.mock.calls[0]?.[0]).toMatchObject({ params: target }));
  });

  it('關注狀態讀取失敗 → 按鈕留著並可重試，不消失（docs/architecture/frontend/07-ui-system.md §6.1）', async () => {
    api.watchState.mockRejectedValueOnce(new Error('boom'));
    renderPanel();
    const button = await screen.findByTestId('comment-watch-button');
    await waitFor(() => expect(button).toHaveAttribute('data-value', 'error'));
    fireEvent.click(button);
    await waitFor(() => expect(button).toHaveAttribute('data-value', 'idle'));
    expect(api.watch).not.toHaveBeenCalled();
  });

  it('關注中時按下是取消關注', async () => {
    api.watchState.mockResolvedValue({ watching: true, watcherCount: 2 });
    renderPanel();
    const button = await screen.findByTestId('comment-watch-button');
    await waitFor(() => expect(button).toHaveAttribute('data-value', 'watching'));
    fireEvent.click(button);
    await waitFor(() => expect(api.unwatch.mock.calls[0]?.[0]).toMatchObject({ params: target }));
  });

  it('沒有登記的資源類型不渲染', () => {
    render(
      <AllProviders>
        <CommentPanel resourceType="webhook" resourceId={USER_ID} />
      </AllProviders>,
    );
    expect(screen.queryByTestId('comment-panel')).not.toBeInTheDocument();
    expect(api.list).not.toHaveBeenCalled();
  });
});
