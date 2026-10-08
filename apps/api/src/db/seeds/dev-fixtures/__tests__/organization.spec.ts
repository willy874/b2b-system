import { describe, expect, it } from 'vitest';

import { ORG_UNIT_SEEDS } from '../organization';

/** 這些不變條件由資料庫擋（唯一索引、外鍵），寫錯時 seed 會半途失敗；在單元測試先擋下。 */
describe('dev seed 的部門樹（docs/architecture/backend/23-organization.md）', () => {
  it('上層都先出現在清單前面（parent_id 是外鍵）', () => {
    const seen = new Set<string>();
    for (const seed of ORG_UNIT_SEEDS) {
      if (seed.parent) expect(seen).toContain(seed.parent);
      seen.add(seed.key);
    }
  });

  it('一人最多一個主要部門（org_unit_members_primary_key）', () => {
    const primaries = ORG_UNIT_SEEDS.flatMap((seed) => [...seed.managers, ...seed.members]);
    expect(new Set(primaries).size).toBe(primaries.length);
  });

  it('同一個上層之下名稱不重複；代碼不重複', () => {
    const siblings = ORG_UNIT_SEEDS.filter((seed) => !seed.deleted).map(
      (seed) => `${seed.parent ?? ''}/${seed.name}`,
    );
    expect(new Set(siblings).size).toBe(siblings.length);
    const codes = ORG_UNIT_SEEDS.map((seed) => seed.key);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('使用者序號在 dev01～dev50 之內', () => {
    for (const seed of ORG_UNIT_SEEDS) {
      for (const serial of [...seed.managers, ...seed.members, ...(seed.secondary ?? [])]) {
        expect(serial).toBeGreaterThanOrEqual(1);
        expect(serial).toBeLessThanOrEqual(50);
      }
    }
  });
});
