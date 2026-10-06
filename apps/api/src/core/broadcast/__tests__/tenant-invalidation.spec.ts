import { describe, expect, it } from 'vitest';

import { parseTenantInvalidation } from '../tenant-invalidation';

describe('parseTenantInvalidation（docs/architecture/06-external-api.md §9.2 D16）', () => {
  it.each([
    ['只有 tenant', { tenant: 't1' }, { tenant: 't1' }],
    ['多出的欄位被丟掉', { tenant: 't1', extra: 1 }, { tenant: 't1' }],
    ['空字串仍是字串', { tenant: '' }, { tenant: '' }],
  ])('接受：%s', (_name, value, expected) => {
    expect(parseTenantInvalidation(value)).toEqual(expected);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['字串', 't1'],
    ['數字', 1],
    ['沒有 tenant', {}],
    ['tenant 不是字串', { tenant: 1 }],
    ['tenant 是 null', { tenant: null }],
  ])('格式不對 → null：%s', (_name, value) => {
    expect(parseTenantInvalidation(value)).toBeNull();
  });
});
