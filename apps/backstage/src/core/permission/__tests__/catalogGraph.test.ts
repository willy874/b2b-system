import { describe, expect, it } from 'vitest';

import type { Permission } from '@/shared/api-sdk';

import { dependentKeys } from '../catalogGraph';

const item = (key: string, includes: string[] = [], requires: string[] = []) =>
  ({ key, includes, requires }) as unknown as Pick<Permission, 'key' | 'includes' | 'requires'>;

const CATALOG = [
  item('user:read'),
  item('user:update', ['user:read']),
  item('user:delete', ['user:update']),
  item('role:update', [], ['user:read']),
];

describe('dependentKeys', () => {
  it('列出直接包含（子能力）或依賴它的鍵，不遞迴', () => {
    expect(dependentKeys(CATALOG, 'user:read')).toEqual(['user:update', 'role:update']);
    expect(dependentKeys(CATALOG, 'user:update')).toEqual(['user:delete']);
  });

  it('最上層的鍵沒有任何鍵帶出它', () => {
    expect(dependentKeys(CATALOG, 'user:delete')).toEqual([]);
  });
});
