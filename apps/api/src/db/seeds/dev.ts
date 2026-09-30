import { and, eq, isNull, sql } from 'drizzle-orm';

import { hashPassword } from '@/modules/credential/password';

import type { ScriptDatabase } from '../client';
import { forEachScriptTenant, loadScriptEnv, seedTenantCode } from '../client';
import {
  auditLogs,
  permissions,
  relationTuples,
  roleHolderTuple,
  rolePermissionTuple,
  roles,
  users,
} from '../schema';

/** 固定亂數種子，確保 E2E fixture 可重現。 */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d_2b_79_f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const DEV_PASSWORD = 'Dev!Password123';
const DEV_DOMAIN = '@dev.local';

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

  const random = mulberry32(20_260_920);
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
      await db
        .insert(relationTuples)
        .values(
          rows
            .filter((row) => seed.keys.includes(row.key))
            .map((row) => rolePermissionTuple(roleId as string, row.key)),
        )
        .onConflictDoNothing();
    }
    if (roleId) roleIds.push(roleId);
  }

  // ── 50 位使用者 ──────────────────────────────────────────
  const createdUserIds: string[] = [];
  for (const [index, status] of STATUS_PLAN.entries()) {
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
        passwordHash: status === 'pending' ? null : passwordHash,
        status,
        lockedUntil: status === 'locked' ? new Date(Date.now() + 15 * 60 * 1000) : null,
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

  console.info(
    `dev seed 完成：${CUSTOM_ROLES.length} 個自訂角色、${STATUS_PLAN.length} 位使用者、稽核日誌 ≥ 300 筆`,
  );
  console.info(`所有假帳號密碼：${DEV_PASSWORD}（網域 ${DEV_DOMAIN}，不會誤寄信）`);
}

async function main(): Promise<void> {
  loadScriptEnv();
  await forEachScriptTenant((db) => seedDevData(db), { code: seedTenantCode() });
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
