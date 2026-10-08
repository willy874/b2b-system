import { describe, expect, it } from 'vitest';

import { parseProcessRoles, processRolesOf, serviceNameOf } from '../process-roles';

describe('程序角色（docs/features/multi-instance.md §初步構想 1）', () => {
  it('all 是三個角色', () => {
    expect([...(parseProcessRoles('all') ?? [])]).toEqual(['http', 'realtime', 'worker']);
  });

  it('逗號分隔、忽略空白與空項目', () => {
    expect([...(parseProcessRoles(' worker, http ,') ?? [])]).toEqual(['worker', 'http']);
  });

  it.each(['', 'api', 'http,all', ' , '])('格式不對 → undefined：%j', (value) => {
    expect(parseProcessRoles(value)).toBeUndefined();
  });

  it('沒設定 = 單體', () => {
    expect(processRolesOf({}).size).toBe(3);
  });

  it.each([
    ['all', 'api'],
    ['http', 'api-http'],
    ['worker,http', 'api-http-worker'],
    ['realtime', 'api-realtime'],
  ])('服務名稱：%s → %s', (value, expected) => {
    expect(serviceNameOf(processRolesOf({ APP_ROLES: value }))).toBe(expected);
  });
});
