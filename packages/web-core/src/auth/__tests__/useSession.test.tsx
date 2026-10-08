import { act, renderHook } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { sessionStore } from '../SessionStore';
import { useHasSession } from '../useSession';

function Probe() {
  return <span>{String(useHasSession())}</span>;
}

describe('useHasSession', () => {
  it('登入 / 登出時重新渲染', () => {
    sessionStore.clear();
    const { result } = renderHook(() => useHasSession());
    expect(result.current).toBe(false);

    act(() => sessionStore.setTokens({ accessToken: 'token', expiresIn: 300 }));
    expect(result.current).toBe(true);

    act(() => sessionStore.endSession('logout'));
    expect(result.current).toBe(false);
  });

  it('rerender 不會退訂再重新訂閱（subscribe 是穩定的函式）', () => {
    const subscribe = vi.spyOn(sessionStore, 'subscribe');
    const { rerender, unmount } = renderHook(() => useHasSession());
    rerender();
    rerender();
    expect(subscribe).toHaveBeenCalledTimes(1);
    unmount();
    subscribe.mockRestore();
  });

  it('伺服器端渲染時一律視為沒有 session', () => {
    act(() => sessionStore.setTokens({ accessToken: 'token', expiresIn: 300 }));
    expect(renderToString(<Probe />)).toContain('false');
    sessionStore.clear();
  });
});
