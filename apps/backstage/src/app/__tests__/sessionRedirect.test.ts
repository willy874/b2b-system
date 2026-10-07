import { describe, expect, it } from 'vitest';

import { isPublic } from '../sessionRedirect';

// 導向登入頁的參數（loginSearchAfterSessionEnd）在 web-core 的 shell/__tests__/loginSearch.test.ts
describe('isPublic', () => {
  it.each([
    ['/auth', true],
    ['/auth/login', true],
    ['/authx', false],
    ['/user', false],
  ])('%s → %s', (pathname, expected) => {
    expect(isPublic(pathname)).toBe(expected);
  });
});
