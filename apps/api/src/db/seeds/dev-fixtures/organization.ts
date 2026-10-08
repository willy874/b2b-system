import type { ScriptDatabase } from '../../client';
import { orgUnitMembers, orgUnits } from '../../schema';
import type { DevFixtureContext } from './context';
import { ago, fixtureId } from './context';

/**
 * 組織（docs/architecture/backend/23-organization.md）：一棵與 dev 群組分工對得上的部門樹，讓組織頁、使用者詳情的「所屬部門」、
 * 使用者列表的部門篩選與多階段審批的「申請人的主管」有資料可看。
 *
 * 刻意放進來的情境：
 * - 一個部門有兩位主管（客服中心：dev14、dev15，彼此可以互審）。
 * - 部門沒有主管（人資組）：往上一層找到管理處的主管。
 * - 主管本人的上一層主管（dev01 → dev13 → dev30）。
 * - 一人屬於多個部門、只有一個主要部門（dev02 另屬內容團隊、dev13 另屬總經理室）。
 * - 沒有主管、也沒有上層的獨立部門（外部協力），成員含停用與待啟用的帳號。
 * - 一個已刪除的部門（回收桶的「部門」分頁）。
 */

export interface OrgUnitSeed {
  /** 固定 id 的 key，也是代碼（大寫即代碼）。 */
  key: string;
  name: string;
  description: string | null;
  /** 上層的 key；null = 最上層。上層要先出現在清單前面。 */
  parent: string | null;
  /** dev 使用者的序號（1 起算）。 */
  managers: number[];
  /** 以這個部門為主要部門的一般成員。 */
  members: number[];
  /** 屬於這個部門、但主要部門在別處的人（矩陣式的兼任）。 */
  secondary?: number[];
  /** 職稱：序號 → 職稱。 */
  titles?: Record<number, string>;
  /** 已刪除（進回收桶）。 */
  deleted?: boolean;
}

export const ORG_UNIT_SEEDS: OrgUnitSeed[] = [
  {
    key: 'ceo',
    name: '總經理室',
    description: '公司最上層',
    parent: null,
    managers: [30],
    members: [31],
    secondary: [13],
    titles: { 30: '總經理', 31: '特別助理' },
  },
  {
    key: 'tech',
    name: '技術處',
    description: '產品研發與維運',
    parent: 'ceo',
    managers: [13],
    members: [],
    titles: { 13: '技術長' },
  },
  {
    key: 'fe',
    name: '前端組',
    description: 'Web 與後台介面',
    parent: 'tech',
    managers: [1],
    members: [2, 3, 4, 5, 6],
    titles: { 1: '前端組長' },
  },
  {
    key: 'be',
    name: '後端組',
    description: 'API 與資料庫',
    parent: 'tech',
    managers: [7],
    members: [8, 9, 10, 11, 12],
    titles: { 7: '後端組長' },
  },
  {
    key: 'ops',
    name: '營運處',
    description: '客服與內容',
    parent: 'ceo',
    managers: [32],
    members: [],
    titles: { 32: '營運長' },
  },
  {
    key: 'cs',
    name: '客服中心',
    description: '第一線客戶支援（兩位主管輪值）',
    parent: 'ops',
    managers: [14, 15],
    members: [16, 17, 18, 19, 20],
    titles: { 14: '客服主任', 15: '客服主任' },
  },
  {
    key: 'content',
    name: '內容團隊',
    description: '文案、素材與上架',
    parent: 'ops',
    managers: [21],
    members: [22, 23, 24, 25, 26],
    secondary: [2],
    titles: { 21: '內容主編', 2: '介面文案（兼任）' },
  },
  {
    key: 'admin',
    name: '管理處',
    description: '財務、人資與稽核',
    parent: 'ceo',
    managers: [33],
    members: [],
    titles: { 33: '管理處處長' },
  },
  {
    key: 'fin',
    name: '財務組',
    description: '請款、付款與帳務',
    parent: 'admin',
    managers: [34],
    members: [35, 27, 28],
    titles: { 34: '財務經理' },
  },
  {
    // 沒有主管：人資組的人往上找到管理處處長
    key: 'hr',
    name: '人資組',
    description: '招募與人事（主管出缺中）',
    parent: 'admin',
    managers: [],
    members: [29],
  },
  {
    key: 'partner',
    name: '外部協力',
    description: '外包夥伴；不屬於公司組織、沒有主管',
    parent: null,
    managers: [],
    members: [36, 37, 44, 45],
  },
  {
    key: 'legacy',
    name: '舊專案部',
    description: '已裁撤（回收桶）',
    parent: 'tech',
    managers: [],
    members: [],
    deleted: true,
  },
];

export interface OrganizationFixtureResult {
  units: number;
  members: number;
}

export async function seedOrganizationFixtures(
  db: ScriptDatabase,
  ctx: DevFixtureContext,
): Promise<OrganizationFixtureResult> {
  let members = 0;
  for (const [index, seed] of ORG_UNIT_SEEDS.entries()) {
    const unitId = fixtureId(`orgUnit:${seed.key}`);
    // oxlint-disable-next-line no-await-in-loop -- seed 腳本；上層要先建好（parent_id 是外鍵）
    await db
      .insert(orgUnits)
      .values({
        id: unitId,
        parentId: seed.parent ? fixtureId(`orgUnit:${seed.parent}`) : null,
        name: seed.name,
        code: seed.key.toUpperCase(),
        description: seed.description,
        sortOrder: index,
        createdBy: ctx.actorId,
        updatedBy: ctx.actorId,
        deletedAt: seed.deleted ? ago(ctx.now, 3) : null,
      })
      .onConflictDoNothing();

    const rows = [
      ...seed.managers.map((serial) => ({ serial, isManager: true, isPrimary: true })),
      ...seed.members.map((serial) => ({ serial, isManager: false, isPrimary: true })),
      ...(seed.secondary ?? []).map((serial) => ({ serial, isManager: false, isPrimary: false })),
    ].flatMap(({ serial, isManager, isPrimary }) => {
      const userId = ctx.userIds[serial - 1];
      return userId
        ? [
            {
              unitId,
              userId,
              isManager,
              isPrimary,
              title: seed.titles?.[serial] ?? null,
              createdBy: ctx.actorId,
            },
          ]
        : [];
    });
    if (rows.length) {
      // 已有的成員資格（含被人改過的）不覆寫；一人一個主要部門由 ORG_UNIT_SEEDS 的規劃保證（測試檢查）
      // oxlint-disable-next-line no-await-in-loop -- 同上
      const inserted = await db
        .insert(orgUnitMembers)
        .values(rows)
        .onConflictDoNothing()
        .returning({ userId: orgUnitMembers.userId });
      members += inserted.length;
    }
  }
  return { units: ORG_UNIT_SEEDS.length, members };
}
