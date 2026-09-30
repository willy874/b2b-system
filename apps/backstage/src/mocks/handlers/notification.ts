import { HttpResponse, http } from 'msw';

import type { Notification } from '@/shared/api-sdk';

import { MOCK_API_BASE } from '../config';
import { NOTIFICATION_FIXTURES } from '../resources/fixtures';

/**
 * 站內通知（docs/architecture/backend/15-notification.md §6）：只需要登入、只看得到自己的，所以不檢查權限
 * （沒有 403 的情境）。已讀會改變狀態：mock 模式下點了通知，鈴鐺的未讀數跟著減少；重新整理就還原。
 */
let notifications: Notification[] = structuredClone(NOTIFICATION_FIXTURES);

/** 測試用：還原成 fixture。 */
export function resetMockNotifications(items: Notification[] = NOTIFICATION_FIXTURES): void {
  notifications = structuredClone(items);
}

const unread = () => notifications.filter((item) => item.readAt === null);

export const notificationHandlers = [
  http.get(`${MOCK_API_BASE}/notifications`, ({ request }) => {
    const search = new URL(request.url).searchParams;
    const limit = Number(search.get('limit') ?? 20);
    // mock 的游標就是下一頁的起點（真正的後端是 created_at ＋ id 的 keyset）
    const start = Number(search.get('cursor') ?? 0);
    const source = search.get('unread') === 'true' ? unread() : notifications;
    const items = source.slice(start, start + limit);
    const next = start + limit;
    return HttpResponse.json({
      data: { items, nextCursor: next < source.length ? String(next) : null },
    });
  }),
  http.get(`${MOCK_API_BASE}/notifications/unread-count`, () =>
    HttpResponse.json({ data: { count: unread().length } }),
  ),
  http.post(`${MOCK_API_BASE}/notifications/read-all`, () => {
    const now = new Date().toISOString();
    const updated = unread().length;
    notifications = notifications.map((item) => ({ ...item, readAt: item.readAt ?? now }));
    return HttpResponse.json({ data: { updated } });
  }),
  http.post(`${MOCK_API_BASE}/notifications/:id/read`, ({ params }) => {
    const target = notifications.find((item) => item.id === params.id);
    if (!target) {
      return HttpResponse.json(
        { error: { code: 'NOTIFICATION_NOT_FOUND', message: 'NOTIFICATION_NOT_FOUND' } },
        { status: 404 },
      );
    }
    target.readAt ??= new Date().toISOString();
    return HttpResponse.json({ data: target });
  }),
];
