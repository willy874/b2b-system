import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useAuditLogCursor } from '../useAuditLogCursor';

describe('useAuditLogCursor（依序翻頁改用游標）', () => {
  it('載入一頁後，下一頁（offset + limit）帶它的 nextCursor', () => {
    const { result, rerender } = renderHook(
      ({ offset }) => useAuditLogCursor('scope', offset, 50),
      { initialProps: { offset: 0 } },
    );
    expect(result.current.cursor).toBeUndefined();
    act(() => result.current.remember(0, 'next-1'));
    rerender({ offset: 50 });
    expect(result.current.cursor).toBe('next-1');
  });

  it('沒有下一頁（null）不記；跳到沒去過的頁沒有游標', () => {
    const { result, rerender } = renderHook(
      ({ offset }) => useAuditLogCursor('scope', offset, 50),
      { initialProps: { offset: 0 } },
    );
    act(() => result.current.remember(0, null));
    rerender({ offset: 50 });
    expect(result.current.cursor).toBeUndefined();
    rerender({ offset: 500 });
    expect(result.current.cursor).toBeUndefined();
  });

  it('篩選條件改變 → 之前記下的游標作廢', () => {
    const { result, rerender } = renderHook(
      ({ scope, offset }) => useAuditLogCursor(scope, offset, 50),
      { initialProps: { scope: 'a', offset: 0 } },
    );
    act(() => result.current.remember(0, 'next-1'));
    rerender({ scope: 'b', offset: 50 });
    expect(result.current.cursor).toBeUndefined();
  });
});
