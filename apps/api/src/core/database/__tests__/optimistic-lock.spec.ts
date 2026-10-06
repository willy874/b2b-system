import { describe, expect, it, vi } from 'vitest';

import { AppException } from '@/core/errors';

import { missedUpdate } from '../optimistic-lock';

const CODES = { notFound: 'ROLE_NOT_FOUND', conflict: 'ROLE_VERSION_CONFLICT' } as const;

describe('missedUpdate（docs/architecture/backend/03-api-conventions.md §11）', () => {
  it('重讀得到版本 → <RESOURCE>_VERSION_CONFLICT，details.current 是重讀到的版本', async () => {
    const findVersion = vi.fn(async () => 3);
    const error = await missedUpdate(findVersion, CODES);
    expect(error).toBeInstanceOf(AppException);
    expect(error).toMatchObject({ code: 'ROLE_VERSION_CONFLICT', details: { current: 3 } });
    expect(findVersion).toHaveBeenCalledTimes(1);
  });

  it('重讀不到（已刪除）→ <RESOURCE>_NOT_FOUND，不帶 details', async () => {
    const error = await missedUpdate(async () => undefined, CODES);
    expect(error).toMatchObject({ code: 'ROLE_NOT_FOUND', details: undefined });
  });
});
