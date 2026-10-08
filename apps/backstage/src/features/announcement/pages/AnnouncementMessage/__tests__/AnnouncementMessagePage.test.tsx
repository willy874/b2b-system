import { AppError } from '@b2b-system/web-core/errors';
import { renderRoute } from '@b2b-system/web-core/testing';
import { screen } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetPagePermissionRegistry } from '@/core/permission';
import { initTestI18n } from '@/test/i18n';

import { registerAnnouncementPagePermissions, Routes } from '../../..';
import zhTW from '../../../locales/zh_TW.json';

const { fetchMessage } = vi.hoisted(() => ({ fetchMessage: vi.fn() }));
vi.mock('@/apis/announcement/get-announcement-message/fetcher', () => ({
  fetchAnnouncementMessageQuery: fetchMessage,
}));

const routes = [Routes.AnnouncementMessageRoute];

beforeAll(() => initTestI18n(zhTW));

beforeEach(() => {
  resetPagePermissionRegistry();
  registerAnnouncementPagePermissions();
  fetchMessage.mockReset().mockResolvedValue({
    dispatchId: 'd1',
    title: '系統維護通知',
    body: {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: '本週六停機。' }] },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: '請提前存檔', marks: [{ type: 'bold' }] },
            { type: 'text', text: '。' },
          ],
        },
      ],
    },
    sentAt: '2026-10-01T00:00:00.000Z',
    sender: { id: 'u1', displayName: '管理員' },
  });
});

describe('AnnouncementMessagePage（收件人看全文，docs/architecture/backend/19-announcement.md §9.2 D4）', () => {
  it('沒有任何權限也看得到自己收到的全文（富文本：段落、粗體）與送出者', async () => {
    renderRoute(routes, '/announcement/message/d1', []);
    expect(
      await screen.findByTestId('announcement-message-title', undefined, { timeout: 5000 }),
    ).toHaveTextContent('系統維護通知');
    const body = screen.getByTestId('announcement-message-body');
    expect(Array.from(body.querySelectorAll('p'), (p) => p.textContent)).toEqual([
      '本週六停機。',
      '請提前存檔。',
    ]);
    expect(screen.getByText('請提前存檔').tagName).toBe('STRONG');
    expect(screen.getByText(/管理員/)).toBeInTheDocument();
    expect(fetchMessage.mock.calls[0]![0]).toMatchObject({ params: { dispatchId: 'd1' } });
  });

  it('沒收到或已撤回（404）→ 錯誤畫面、沒有重試', async () => {
    fetchMessage.mockRejectedValue(new AppError('ANNOUNCEMENT_MESSAGE_NOT_FOUND', 404));
    renderRoute(routes, '/announcement/message/d1', []);
    expect(
      await screen.findByTestId('announcement-message-error', undefined, { timeout: 5000 }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('query-error-retry')).toBeNull();
  });
});
