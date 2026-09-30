import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { sessionStore } from '../SessionStore';
import { useHasSession } from '../useSession';

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
});
