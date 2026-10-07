import { and, eq, isNull, sql } from 'drizzle-orm';

import { hashPassword } from '@/modules/credential/password';

import { recordRoleBaseline } from '../bootstrap';
import type { ScriptDatabase } from '../client';
import {
  assertDisposableScriptTargets,
  forEachScriptTenant,
  loadScriptEnv,
  seedTenantCode,
} from '../client';
import {
  auditLogs,
  groupMemberTuple,
  groupRoleTuple,
  groups,
  permissions,
  relationTuples,
  roleHolderTuple,
  rolePermissionTuple,
  roles,
  users,
} from '../schema';
import { createRandom, seedDevFixtures } from './dev-fixtures';

const DEV_PASSWORD = 'Dev!Password123';
const DEV_DOMAIN = '@dev.local';

/**
 * 顯示的狀態分布。`locked` 是登入失敗的自動鎖定：`status = active` ＋ 15 分鐘後到期的 `locked_until`
 * （docs/architecture/backend/04-auth.md §3.3），到期後恢復成 active。
 */
const STATUS_PLAN = [
  ...Array.from({ length: 35 }, () => 'active' as const),
  ...Array.from({ length: 8 }, () => 'inactive' as const),
  ...Array.from({ length: 5 }, () => 'pending' as const),
  ...Array.from({ length: 2 }, () => 'locked' as const),
];

const CUSTOM_ROLES = [
  { slug: 'content-editor', name: '內容編輯', keys: ['user:read', 'auditLog:read'] },
  { slug: 'support', name: '客服', keys: ['user:read', 'role:read'] },
  {
    slug: 'release-manager',
    name: '發佈管理',
    keys: ['user:read', 'role:read', 'permission:read'],
  },
  { slug: 'qa', name: '測試', keys: ['auditLog:read', 'system:read'] },
  { slug: 'read-only', name: '唯讀', keys: ['user:read'] },
];

/**
 * 群組：`users` 是 dev 使用者的序號（1 起算）、`groups` 是巢狀的子群組（要先出現在清單前面）、`roles` 是自訂角色的 slug。
 * 巢狀最深 3 層（全體員工 → 工程部 → 前端組），在 GROUP_MAX_NESTING_DEPTH 之內。
 */
const DEV_GROUPS: {
  name: string;
  description: string | null;
  users: number[];
  groups: string[];
  roles: string[];
}[] = [
  {
    name: '前端組',
    description: 'Web 與後台介面',
    users: [1, 2, 3, 4, 5, 6],
    groups: [],
    roles: ['release-manager'],
  },
  {
    name: '後端組',
    description: 'API 與資料庫',
    users: [7, 8, 9, 10, 11, 12],
    groups: [],
    roles: [],
  },
  {
    name: '工程部',
    description: '前端組與後端組，另含技術主管',
    users: [13],
    groups: ['前端組', '後端組'],
    roles: ['qa'],
  },
  {
    name: '客服中心',
    description: '第一線客戶支援',
    users: [14, 15, 16, 17, 18, 19, 20],
    groups: [],
    roles: ['support'],
  },
  {
    name: '內容團隊',
    description: '文案、素材與上架',
    users: [21, 22, 23, 24, 25, 26],
    groups: [],
    roles: ['content-editor'],
  },
  {
    name: '全體員工',
    description: '所有正職部門',
    users: [],
    groups: ['工程部', '客服中心', '內容團隊'],
    roles: ['read-only'],
  },
  {
    name: '稽核小組',
    description: '季度稽核，暫不持有角色',
    users: [27, 28, 29],
    groups: [],
    roles: [],
  },
  {
    name: '外包夥伴',
    description: '含停用與待啟用的帳號',
    users: [36, 37, 44, 45],
    groups: [],
    roles: [],
  },
  { name: '新專案小組', description: null, users: [], groups: [], roles: [] },
];

const ACTIONS = [
  'user.create',
  'user.update',
  'user.delete',
  'user.assignRole',
  'role.create',
  'role.update',
  'role.grantPermission',
  'auth.login.success',
  'auth.login.failure',
  'authz.denied',
];

export async function seedDevData(db: ScriptDatabase): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('db:seed:dev 不可在 production 執行');
  }

  const random = createRandom(20_260_920);
  const passwordHash = await hashPassword(DEV_PASSWORD);

  // ── 5 個自訂角色 ─────────────────────────────────────────
  const roleIds: string[] = [];
  for (const seed of CUSTOM_ROLES) {
    const [existing] = await db
      .select()
      .from(roles)
      .where(and(eq(roles.slug, seed.slug), isNull(roles.deletedAt)))
      .limit(1);

    let roleId = existing?.id;
    if (!roleId) {
      const [created] = await db
        .insert(roles)
        .values({ slug: seed.slug, name: seed.name, isSystem: false })
        .returning();
      roleId = created?.id;
      const rows = await db.select().from(permissions);
      const granted = rows.filter((row) => seed.keys.includes(row.key)).map((row) => row.key);
      await db
        .insert(relationTuples)
        .values(granted.map((key) => rolePermissionTuple(roleId as string, key)))
        .onConflictDoNothing();
      // oxlint-disable-next-line no-await-in-loop -- seed 腳本，角色數量少，依序執行
      if (created) await recordRoleBaseline(db, created, granted);
    }
    if (roleId) roleIds.push(roleId);
  }

  // ── 50 位使用者 ──────────────────────────────────────────
  const createdUserIds: string[] = [];
  for (const [index, plan] of STATUS_PLAN.entries()) {
    const email = `dev${String(index + 1).padStart(2, '0')}${DEV_DOMAIN}`;
    const [existing] = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.email, email), isNull(users.deletedAt)))
      .limit(1);
    if (existing) {
      createdUserIds.push(existing.id);
      continue;
    }

    const [created] = await db
      .insert(users)
      .values({
        email,
        username: `dev${String(index + 1).padStart(2, '0')}`,
        displayName: `Dev User ${index + 1}`,
        passwordHash: plan === 'pending' ? null : passwordHash,
        status: plan === 'locked' ? 'active' : plan,
        lockedUntil: plan === 'locked' ? new Date(Date.now() + 15 * 60 * 1000) : null,
      })
      .returning({ id: users.id });
    if (!created) continue;
    createdUserIds.push(created.id);

    // 隨機指派 0–2 個角色
    const count = Math.floor(random() * 3);
    const shuffled = [...roleIds].sort(() => random() - 0.5).slice(0, count);
    if (shuffled.length) {
      await db
        .insert(relationTuples)
        .values(shuffled.map((roleId) => roleHolderTuple(roleId, created.id)))
        .onConflictDoNothing();
    }
  }

  // ── 9 個群組（含巢狀與持有角色）────────────────────────
  // 已存在的群組不動它的成員與角色，重跑不會把手動調整蓋掉
  const roleIdBySlug = new Map(CUSTOM_ROLES.map((seed, index) => [seed.slug, roleIds[index]]));
  const groupIdByName = new Map<string, string>();
  for (const seed of DEV_GROUPS) {
    const [existing] = await db
      .select({ id: groups.id })
      .from(groups)
      .where(and(sql`lower(${groups.name}) = lower(${seed.name})`, isNull(groups.deletedAt)))
      .limit(1);
    if (existing) {
      groupIdByName.set(seed.name, existing.id);
      continue;
    }

    const [created] = await db
      .insert(groups)
      .values({ name: seed.name, description: seed.description })
      .returning({ id: groups.id });
    if (!created) continue;
    groupIdByName.set(seed.name, created.id);

    const tuples = [
      ...seed.users
        .map((serial) => createdUserIds[serial - 1])
        .filter((id): id is string => Boolean(id))
        .map((id) => groupMemberTuple(created.id, { type: 'user', id })),
      ...seed.groups
        .map((name) => groupIdByName.get(name))
        .filter((id): id is string => Boolean(id))
        .map((id) => groupMemberTuple(created.id, { type: 'group', id })),
      ...seed.roles
        .map((slug) => roleIdBySlug.get(slug))
        .filter((id): id is string => Boolean(id))
        .map((roleId) => groupRoleTuple(roleId, created.id)),
    ];
    if (tuples.length) {
      // oxlint-disable-next-line no-await-in-loop -- seed 腳本，巢狀群組要等子群組建好
      await db.insert(relationTuples).values(tuples).onConflictDoNothing();
    }
  }

  // ── 300 筆稽核日誌（跨 90 天）───────────────────────────
  const [{ total } = { total: 0 }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(auditLogs);
  if (total < 300) {
    const rows = Array.from({ length: 300 }, (_, index) => {
      const action = ACTIONS[Math.floor(random() * ACTIONS.length)] as string;
      const failure = random() < 0.15;
      const daysAgo = Math.floor(random() * 90);
      return {
        occurredAt: new Date(Date.now() - daysAgo * 86_400_000 - index * 1000),
        actorId: createdUserIds[Math.floor(random() * createdUserIds.length)] ?? null,
        actorEmail: `dev${String(Math.floor(random() * 50) + 1).padStart(2, '0')}${DEV_DOMAIN}`,
        action,
        resourceType: action.split('.')[0] ?? 'system',
        resourceId: null,
        resourceName: null,
        result: failure ? ('failure' as const) : ('success' as const),
        errorCode: failure ? 'AUTHZ_FORBIDDEN' : null,
        changes: null,
        metadata: { seeded: true },
      };
    });
    await db.insert(auditLogs).values(rows);
  }

  // ── 通知、公告、回收桶、Webhook、標籤（dev-fixtures/）──────
  const fixtureSummary = await seedDevFixtures(db, {
    userIds: createdUserIds,
    roleIdBySlug: new Map(
      [...roleIdBySlug].filter((entry): entry is [string, string] => Boolean(entry[1])),
    ),
    groupIdByName,
  });

  console.info(
    `dev seed 完成：${CUSTOM_ROLES.length} 個自訂角色、${STATUS_PLAN.length} 位使用者、${DEV_GROUPS.length} 個群組、稽核日誌 ≥ 300 筆`,
  );
  for (const line of fixtureSummary) console.info(`  ${line}`);
  console.info(`所有假帳號密碼：${DEV_PASSWORD}（網域 ${DEV_DOMAIN}，不會誤寄信）`);
}

async function main(): Promise<void> {
  loadScriptEnv();
  const code = seedTenantCode();
  await assertDisposableScriptTargets('db:seed:dev', { code });
  await forEachScriptTenant((db) => seedDevData(db), { code });
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
