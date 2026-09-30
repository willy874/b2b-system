import { beforeEach, describe, expect, it } from 'vitest';

import type { PermissionKey } from '@/core/permission';

import { getTrashTypes, registerTrashType, resetTrashRegistry } from '../registry';
import type { TrashTypeRegistration } from '../registry';

const USER_TYPE: TrashTypeRegistration = {
  type: 'user',
  order: 10,
  labelI18nKey: 'menu.user',
  permission: 'user:delete' as PermissionKey,
  RestoreAction: () => null,
};

describe('回收桶的類型註冊表（docs/architecture/frontend/13-trash.md）', () => {
  beforeEach(() => resetTrashRegistry());

  it('依 order 排序列出', () => {
    registerTrashType({ ...USER_TYPE, order: 20 });
    expect(getTrashTypes().map((type) => type.type)).toEqual(['user']);
  });

  it('同一個 type 登記兩次會拋錯', () => {
    registerTrashType(USER_TYPE);
    expect(() => registerTrashType(USER_TYPE)).toThrow('user');
  });

  it('反註冊之後消失，可以再登記', () => {
    const dispose = registerTrashType(USER_TYPE);
    dispose();
    expect(getTrashTypes()).toEqual([]);
    expect(() => registerTrashType(USER_TYPE)).not.toThrow();
  });
});
