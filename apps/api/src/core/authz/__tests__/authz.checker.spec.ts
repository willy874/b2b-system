import { describe, expect, it } from 'vitest';

import { createChecker } from '../authz.checker';
import {
  and,
  capabilitiesOf,
  computed,
  createModel,
  defineType,
  direct,
  from,
  impliedRelations,
  isUsersetRelation,
  union,
} from '../authz.model';
import { createSnapshot } from '../authz.snapshot';
import type { TupleEntry } from '../authz.snapshot';
import { buildTenantType, GROUP_TYPE, ROLE_TYPE, USER_TYPE } from '../authz.types';

const doc = (id: string) => ({ type: 'doc', id });
const tuple = (object: string, relation: string, subject: string): TupleEntry => {
  const [type = '', id = ''] = object.split(':');
  return { object: { type, id }, relation, subject };
};

const model = createModel([
  USER_TYPE,
  GROUP_TYPE,
  ROLE_TYPE,
  defineType('folder', {
    viewer: direct('user', 'user:*', 'role#holder', 'group#member'),
  }),
  defineType('doc', {
    parent: direct('folder'),
    owner: direct('user'),
    editor: direct('user', 'role#holder'),
    viewer: union(direct('user'), computed('editor'), from('parent', 'viewer')),
    ownerEditor: and(computed('owner'), computed('editor')),
  }),
]);

describe('關係圖的判斷器（core/authz）', () => {
  it('直接 tuple：主體在閉包裡才成立', () => {
    const snapshot = createSnapshot(['user:alice'], [tuple('doc:a', 'editor', 'user:alice')]);
    const checker = createChecker(model, snapshot);
    expect(checker.check(doc('a'), 'editor')).toBe(true);
    expect(checker.check(doc('b'), 'editor')).toBe(false);
  });

  it('使用者集合：角色的持有者', () => {
    const snapshot = createSnapshot(
      ['user:alice', 'role:r1#holder'],
      [tuple('doc:a', 'editor', 'role:r1#holder'), tuple('doc:b', 'editor', 'role:r2#holder')],
    );
    const checker = createChecker(model, snapshot);
    expect(checker.check(doc('a'), 'editor')).toBe(true);
    expect(checker.check(doc('b'), 'editor')).toBe(false);
  });

  it('群組（ADR-0024 D11）：閉包裡的群組成員可以持有角色、直接取得授權', () => {
    // alice ∈ 角色設計 ∈ 美術；美術持有 r1、美術在 folder:f 上是 viewer（閉包由 subjectClosures 算好）
    const snapshot = createSnapshot(
      ['user:alice', 'group:design#member', 'group:art#member', 'role:r1#holder'],
      [
        tuple('doc:a', 'editor', 'role:r1#holder'),
        tuple('folder:f', 'viewer', 'group:art#member'),
        tuple('doc:b', 'parent', 'folder:f'),
      ],
    );
    const checker = createChecker(model, snapshot);
    expect(checker.check(doc('a'), 'editor')).toBe(true);
    expect(checker.check(doc('b'), 'viewer')).toBe(true);
    // 路徑從閉包裡的主體開始（閉包本身怎麼來的由 G4b 補上）
    expect(checker.explain(doc('b'), 'viewer')).toEqual([
      'group:art#member',
      'folder:f#viewer',
      'doc:b#viewer',
    ]);
  });

  it('群組：閉包沒有涵蓋時沿 group#member 往下展開（巢狀）', () => {
    const snapshot = createSnapshot(
      ['user:alice'],
      [
        tuple('folder:f', 'viewer', 'group:art#member'),
        tuple('group:art', 'member', 'group:design#member'),
        tuple('group:design', 'member', 'user:alice'),
        tuple('doc:b', 'parent', 'folder:f'),
      ],
    );
    expect(createChecker(model, snapshot).check(doc('b'), 'viewer')).toBe(true);
    // 群組的成員關係只接受使用者與群組的成員，寫進去的 role#holder 不算
    const wrongSubject = createSnapshot(
      ['user:alice', 'role:r1#holder'],
      [
        tuple('folder:f', 'viewer', 'group:art#member'),
        tuple('group:art', 'member', 'role:r1#holder'),
      ],
    );
    expect(createChecker(model, wrongSubject).check({ type: 'folder', id: 'f' }, 'viewer')).toBe(
      false,
    );
  });

  it('computed 與 from：editor 蘊含 viewer，viewer 沿 parent 往下流', () => {
    const snapshot = createSnapshot(
      ['user:alice'],
      [
        tuple('doc:a', 'editor', 'user:alice'),
        tuple('doc:b', 'parent', 'folder:f'),
        tuple('folder:f', 'viewer', 'user:alice'),
      ],
    );
    const checker = createChecker(model, snapshot);
    expect(checker.check(doc('a'), 'viewer')).toBe(true);
    expect(checker.check(doc('b'), 'viewer')).toBe(true);
    expect(checker.check(doc('b'), 'editor')).toBe(false);
  });

  it('萬用字元 user:* 對所有人成立，但不是任何一個使用者集合', () => {
    const snapshot = createSnapshot(
      ['user:bob', 'user:*'],
      [tuple('folder:f', 'viewer', 'user:*'), tuple('doc:a', 'parent', 'folder:f')],
    );
    expect(createChecker(model, snapshot).check(doc('a'), 'viewer')).toBe(true);
    // 關係不允許萬用字元時，寫進去的 user:* 不算
    const editor = createSnapshot(['user:bob', 'user:*'], [tuple('doc:a', 'editor', 'user:*')]);
    expect(createChecker(model, editor).check(doc('a'), 'editor')).toBe(false);
  });

  it('交集：兩邊都成立才成立', () => {
    const both = createSnapshot(
      ['user:alice'],
      [tuple('doc:a', 'owner', 'user:alice'), tuple('doc:a', 'editor', 'user:alice')],
    );
    const onlyOwner = createSnapshot(['user:alice'], [tuple('doc:a', 'owner', 'user:alice')]);
    expect(createChecker(model, both).check(doc('a'), 'ownerEditor')).toBe(true);
    expect(createChecker(model, onlyOwner).check(doc('a'), 'ownerEditor')).toBe(false);
  });

  it('未知的型別或關係不成立、不丟錯', () => {
    const checker = createChecker(model, createSnapshot(['user:alice'], []));
    expect(checker.check({ type: 'nope', id: 'x' }, 'viewer')).toBe(false);
    expect(checker.check(doc('a'), 'nope')).toBe(false);
  });

  it('withEdges 替單一物件補上臨時的邊', () => {
    const checker = createChecker(
      model,
      createSnapshot(['user:alice'], [tuple('folder:f', 'viewer', 'user:alice')]),
    );
    expect(checker.check(doc('x'), 'viewer')).toBe(false);
    expect(checker.withEdges(doc('x'), { parent: ['folder:f'] }).check(doc('x'), 'viewer')).toBe(
      true,
    );
  });

  it('explain 回傳由操作者到目標的路徑', () => {
    const snapshot = createSnapshot(
      ['user:alice', 'role:r1#holder'],
      [tuple('doc:b', 'parent', 'folder:f'), tuple('folder:f', 'viewer', 'role:r1#holder')],
    );
    expect(createChecker(model, snapshot).explain(doc('b'), 'viewer')).toEqual([
      'role:r1#holder',
      'folder:f#viewer',
      'doc:b#viewer',
    ]);
  });

  it('資料異常的循環（parent 指回自己）視為不成立', () => {
    const cyclic = createModel([
      USER_TYPE,
      defineType('node', {
        parent: direct('node'),
        viewer: union(direct('user'), from('parent', 'viewer')),
      }),
    ]);
    const snapshot = createSnapshot(
      ['user:alice'],
      [tuple('node:a', 'parent', 'node:b'), tuple('node:b', 'parent', 'node:a')],
    );
    expect(createChecker(cyclic, snapshot).check({ type: 'node', id: 'a' }, 'viewer')).toBe(false);
  });
});

describe('模型驗證（createModel）', () => {
  it('引用不存在的關係或型別、tupleset 不是直接關係、computed 循環都擋下', () => {
    expect(() =>
      createModel([
        USER_TYPE,
        defineType('x', {
          a: computed('missing'),
          b: direct('ghost'),
          c: from('a', 'b'),
          d: computed('e'),
          e: computed('d'),
        }),
      ]),
    ).toThrow(
      /computed 關係 missing 不存在[\s\S]*主體型別 ghost 不存在[\s\S]*tupleset a 必須是直接關係[\s\S]*循環/,
    );
  });
});

describe('靜態蘊含（impliedRelations）', () => {
  it('editor 蘊含 viewer；交集只有在每一邊都蘊含時才算', () => {
    expect([...impliedRelations(model, 'doc', 'editor')].toSorted()).toEqual(['editor', 'viewer']);
    expect(impliedRelations(model, 'doc', 'owner').has('ownerEditor')).toBe(false);
  });
});

const tenant = (withDependencies: boolean) =>
  createModel([USER_TYPE, GROUP_TYPE, ROLE_TYPE, buildTenantType({ withDependencies })]);

describe('租戶型別（由權限目錄產生）', () => {
  const self = { type: 'tenant', id: 'self' };
  const snapshot = createSnapshot(
    ['user:alice', 'role:r1#holder'],
    [tuple('tenant:self', 'file:delete', 'role:r1#holder')],
  );

  it('開啟依賴樹：file:delete 帶來 file:update、file:read、file:access', () => {
    const checker = createChecker(tenant(true), snapshot);
    expect(
      ['file:delete', 'file:update', 'file:read', 'file:access'].map((key) =>
        checker.check(self, key),
      ),
    ).toEqual([true, true, true, true]);
    expect(checker.check(self, 'file:share')).toBe(false);
  });

  it('關閉依賴樹（G1 影子比對）：只有明確授予的鍵', () => {
    const checker = createChecker(tenant(false), snapshot);
    expect(checker.check(self, 'file:delete')).toBe(true);
    expect(checker.check(self, 'file:update')).toBe(false);
  });

  it('superAdmin 讓每個權限關係都成立', () => {
    const checker = createChecker(
      tenant(false),
      createSnapshot(
        ['user:root', 'role:sa#holder'],
        [tuple('tenant:self', 'superAdmin', 'role:sa#holder')],
      ),
    );
    expect(checker.check(self, 'system:update')).toBe(true);
  });
});

describe('反提權的能力（docs/adr/0024-relationship-based-access-control.md G4）', () => {
  const full = createModel([
    USER_TYPE,
    GROUP_TYPE,
    ROLE_TYPE,
    buildTenantType({ withDependencies: true }),
    defineType(
      'folder',
      {
        manager: direct('user'),
        editor: union(direct('user'), computed('manager')),
        can_read: computed('editor'),
        can_share: computed('manager'),
      },
      { capabilities: ['can_read', 'can_share'] },
    ),
  ]);

  it('關係本身是能力（權限鍵、superAdmin）→ 只有它', () => {
    expect(capabilitiesOf(full, 'tenant', 'file:delete')).toEqual(['file:delete']);
    expect(capabilitiesOf(full, 'tenant', 'superAdmin')).toEqual(['superAdmin']);
  });

  it('等級 → 它靜態蘊含的能力，依宣告的順序', () => {
    expect(capabilitiesOf(full, 'folder', 'editor')).toEqual(['can_read']);
    expect(capabilitiesOf(full, 'folder', 'manager')).toEqual(['can_read', 'can_share']);
  });

  it('使用者集合：被別的關係允許當主體的 role#holder、group#member', () => {
    expect(isUsersetRelation(full, 'role', 'holder')).toBe(true);
    expect(isUsersetRelation(full, 'group', 'member')).toBe(true);
    expect(isUsersetRelation(full, 'folder', 'editor')).toBe(false);
  });

  it('宣告了不存在的能力 → 建立模型失敗', () => {
    expect(() =>
      createModel([defineType('doc', { viewer: direct('user') }, { capabilities: ['can_fly'] })]),
    ).toThrow(/能力 can_fly 不是這個型別的關係/);
  });
});
