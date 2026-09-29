import { describe, expect, it } from 'vitest';

import { assignableLevels, levelAllows, missingActions } from '../resource-grant.levels';
import type { LevelActions } from '../resource-grant.levels';

/** 假的資源：驗證 helpers 不依賴檔案的動作（docs/rbac/07-resource-grants.md §10.1）。 */
type Action = 'view' | 'edit' | 'publish';
const ORDER: readonly Action[] = ['view', 'edit', 'publish'];
const LEVELS: LevelActions<Action> = {
  viewer: ['view'],
  contributor: ['view', 'edit'],
  editor: ['view', 'edit'],
  manager: ['view', 'edit', 'publish'],
};

describe('resource-grant.levels（通用的等級 → 動作）', () => {
  it('levelAllows：null 一律否', () => {
    expect(levelAllows(LEVELS, 'contributor', 'edit')).toBe(true);
    expect(levelAllows(LEVELS, 'contributor', 'publish')).toBe(false);
    expect(levelAllows(LEVELS, null, 'view')).toBe(false);
  });

  it('missingActions 依給定順序列出缺少的動作', () => {
    const can = (action: Action) => action === 'view';
    expect(missingActions(LEVELS, ['manager', 'viewer'], ORDER, can)).toEqual(['edit', 'publish']);
  });

  it('assignableLevels：只有能力涵蓋的等級', () => {
    const can = (action: Action) => action !== 'publish';
    expect(assignableLevels(LEVELS, ORDER, can)).toEqual(['viewer', 'contributor', 'editor']);
  });
});
