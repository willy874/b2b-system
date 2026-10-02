import { describe, expect, it } from 'vitest';

import type { Notification } from '@/shared/api-sdk';

import { describeNotification, toNotificationVM, translateMessage } from '../adapter';

/** 假的 `t`：回傳 key 與代入的參數，斷言時看得出用了哪個 key。 */
const fakeT = (key: string, options?: Record<string, unknown>) =>
  options && Object.keys(options).length > 0 ? `${key}${JSON.stringify(options)}` : key;

const base: Notification = {
  id: 'n1',
  type: 'approval.pending',
  params: { approvalType: 'user.register', requesterName: 'carol@example.com', subject: 'Carol' },
  link: { route: 'approval.detail', params: { approvalId: 'a1' } },
  actor: null,
  readAt: null,
  createdAt: '2026-10-01T00:00:00.000Z',
};

describe('describeNotification（依 type 組句子，docs/architecture/backend/15-notification.md §4）', () => {
  it.each([
    [
      'approval.pending：申請人、審批類型的名稱與摘要',
      base,
      'notification.message.approvalPending{"requester":"carol@example.com","type":"notification.approvalType.userRegister"}',
      ['notification.detail.subject{"subject":"Carol"}'],
    ],
    [
      'approval.result 核准',
      {
        ...base,
        type: 'approval.result',
        params: { approvalType: 'fileFolder.access', subject: '設計稿', status: 'approved' },
      },
      'notification.message.approvalApproved{"type":"notification.approvalType.fileFolderAccess"}',
      ['notification.detail.subject{"subject":"設計稿"}'],
    ],
    [
      'approval.result 駁回；摘要是空字串時不顯示',
      {
        ...base,
        type: 'approval.result',
        params: { approvalType: 'user.register', subject: '', status: 'rejected' },
      },
      'notification.message.approvalRejected{"type":"notification.approvalType.userRegister"}',
      [],
    ],
    [
      '審批類型不認得時用通用的名稱',
      { ...base, params: { ...base.params, approvalType: 'future.type' } },
      'notification.message.approvalPending{"requester":"carol@example.com","type":"notification.approvalType.unknown"}',
      ['notification.detail.subject{"subject":"Carol"}'],
    ],
    [
      'user.rolesChanged：增減的角色各一行，沒有的那一邊不顯示',
      { ...base, type: 'user.rolesChanged', params: { added: ['編輯', '稽核'], removed: [] } },
      'notification.message.userRolesChanged',
      ['notification.detail.rolesAdded{"roles":"編輯 and 稽核"}'],
    ],
    [
      'webhook.disabled：名稱與連續失敗次數（docs/adr/0030-webhooks.md D13）',
      { ...base, type: 'webhook.disabled', params: { webhookName: 'CI', consecutiveFailures: 50 } },
      'notification.message.webhookDisabled{"name":"CI","count":"50"}',
      [],
    ],
    [
      'announcement.published：公告的標題（docs/adr/0031-announcements.md D4）',
      { ...base, type: 'announcement.published', params: { title: '系統維護' } },
      'notification.message.announcementPublished{"title":"系統維護"}',
      [],
    ],
  ])('%s', (_name, notification, message, details) => {
    const described = describeNotification(notification);
    expect(translateMessage(fakeT, 'en', described.message)).toBe(message);
    expect(described.details.map((detail) => translateMessage(fakeT, 'en', detail))).toEqual(
      details,
    );
  });

  it.each([
    ['不認得的 type', { type: 'future.event', params: {} }],
    ['webhook.disabled 缺失敗次數', { type: 'webhook.disabled', params: { webhookName: 'CI' } }],
    ['announcement.published 缺標題', { type: 'announcement.published', params: {} }],
    ['approval.pending 缺申請人', { type: 'approval.pending', params: { subject: 'x' } }],
    ['approval.result 的 status 不合預期', { type: 'approval.result', params: { status: 'x' } }],
    ['rolesChanged 的角色不是字串陣列', { type: 'user.rolesChanged', params: { added: [1] } }],
  ])('%s → 通用文字、沒有補充', (_name, notification) => {
    expect(describeNotification(notification)).toEqual({
      message: { key: 'notification.message.unknown', args: {} },
      details: [],
    });
  });
});

describe('toNotificationVM', () => {
  it('已讀狀態、觸發者與解析後的連結', () => {
    const resolved = { to: '/approval/$approvalId', params: { approvalId: 'a1' }, search: {} };
    const vm = toNotificationVM(
      { ...base, actor: { id: 'u1', name: 'Admin' }, readAt: '2026-10-01T01:00:00.000Z' },
      (link) => (link?.route === 'approval.detail' ? resolved : undefined),
    );
    expect(vm).toMatchObject({ id: 'n1', isRead: true, actorName: 'Admin', link: resolved });
  });

  it('系統觸發（actor 為 null）、連結解析不出來 → 不可點', () => {
    const vm = toNotificationVM(base, () => undefined);
    expect(vm.actorName).toBeNull();
    expect(vm.isRead).toBe(false);
    expect(vm.link).toBeUndefined();
  });
});

describe('translateMessage', () => {
  it('清單依語系串起來', () => {
    const message = { key: 'k', args: { roles: { list: ['A', 'B', 'C'] } } };
    expect(translateMessage(fakeT, 'zh-TW', message)).toBe('k{"roles":"A、B和C"}');
  });
});
