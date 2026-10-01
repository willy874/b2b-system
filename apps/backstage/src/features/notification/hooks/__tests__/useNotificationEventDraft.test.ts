import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { NotificationEventView } from '../../types';
import { useNotificationEventDraft } from '../useNotificationEventDraft';

const RESULT: NotificationEventView = {
  type: 'approval.result',
  mandatory: false,
  channels: [
    { channel: 'inApp', enabled: true, defaultEnabled: true, isOverridden: false, updatedAt: null },
    {
      channel: 'email',
      enabled: false,
      defaultEnabled: true,
      isOverridden: true,
      updatedAt: '2026-10-01T00:00:00.000Z',
    },
  ],
};

describe('useNotificationEventDraft（事件管理頁的草稿）', () => {
  it('切換開關 → 記成一筆修改，畫面顯示草稿的值與「已修改」；切回伺服器的值就移除', () => {
    const { result } = renderHook(() => useNotificationEventDraft());
    act(() => result.current.setEnabled(RESULT, 'inApp', false));
    expect(result.current.changes).toEqual([
      { type: 'approval.result', channel: 'inApp', enabled: false },
    ]);
    expect(result.current.current(RESULT, 'inApp')).toEqual({ enabled: false, isOverridden: true });

    act(() => result.current.setEnabled(RESULT, 'inApp', true));
    expect(result.current.isDirty).toBe(false);
  });

  it('有覆寫而切回預設值 → 送「還原預設」（enabled: null）', () => {
    const { result } = renderHook(() => useNotificationEventDraft());
    act(() => result.current.setEnabled(RESULT, 'email', true));
    expect(result.current.changes).toEqual([
      { type: 'approval.result', channel: 'email', enabled: null },
    ]);
    expect(result.current.current(RESULT, 'email')).toEqual({ enabled: true, isOverridden: false });
  });

  it('恢復預設：有覆寫的記成 null；沒有覆寫的不送出', () => {
    const { result } = renderHook(() => useNotificationEventDraft());
    act(() => result.current.resetToDefault(RESULT, 'email'));
    act(() => result.current.resetToDefault(RESULT, 'inApp'));
    expect(result.current.changes).toEqual([
      { type: 'approval.result', channel: 'email', enabled: null },
    ]);
  });

  it('clear → 清空草稿，畫面回到伺服器的值', () => {
    const { result } = renderHook(() => useNotificationEventDraft());
    act(() => result.current.setEnabled(RESULT, 'inApp', false));
    act(() => result.current.clear());
    expect(result.current.isDirty).toBe(false);
    expect(result.current.current(RESULT, 'inApp')).toEqual({ enabled: true, isOverridden: false });
  });
});
