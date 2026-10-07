import { createHash } from 'node:crypto';

import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';

import { DEFAULT_TIMEZONE_SETTING } from '@/core/settings/general.settings';
import { resolveSetting } from '@/core/settings/setting-definition';

import type { ScriptDatabase } from '../../client';
import {
  GROUP_OBJECT_TYPE,
  isGroupMemberTuple,
  isRoleHolderTuple,
  relationTuples,
  roles,
  systemSettings,
  USER_SUBJECT_TYPE,
  users,
} from '../../schema';

/** 固定亂數種子，確保假資料可重現（mulberry32）。 */
export function createRandom(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d_2b_79_f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/**
 * 假資料的固定 id：同一個 key 永遠得到同一個 uuid，重跑 `db:seed:dev` 以 `ON CONFLICT DO NOTHING` 略過已有的列。
 * 不同租戶各有自己的 database，同一個 id 不會互相衝突。
 */
export function fixtureId(key: string): string {
  const hex = createHash('sha256').update(`dev-seed:${key}`).digest('hex');
  // 版本位元標成 5、variant 標成 10xx：仍是合法的 RFC 4122 形狀
  const variant = ((Number.parseInt(hex.slice(16, 18), 16) & 0x3f) | 0x80).toString(16);
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `5${hex.slice(13, 16)}`,
    `${variant}${hex.slice(18, 20)}`,
    hex.slice(20, 32),
  ].join('-');
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** 第一次執行時的「現在」往前推：只在第一次寫入時決定，重跑時已存在的列不變。 */
export function ago(now: Date, days: number, hours = 0): Date {
  return new Date(now.getTime() - days * DAY_MS - hours * HOUR_MS);
}

export function later(now: Date, days: number, hours = 0): Date {
  return new Date(now.getTime() + days * DAY_MS + hours * HOUR_MS);
}

/** dev seed 前段（使用者、角色、群組）交給假資料的結果。 */
export interface DevSeedBase {
  /** dev01～dev50 的 id，依序號排列（`userIds[0]` 是 dev01）。 */
  userIds: readonly string[];
  roleIdBySlug: ReadonlyMap<string, string>;
  groupIdByName: ReadonlyMap<string, string>;
}

export interface DevFixtureContext extends DevSeedBase {
  now: Date;
  /** 操作者：最早的 super-admin（建立、刪除、送出公告的人）；租戶還沒有 super-admin 時為 null。 */
  actorId: string | null;
  /** 可登入的 dev 使用者（未刪除、`active` 的人）：公告的收件人只會是他們。 */
  activeUserIds: ReadonlySet<string>;
  /** 租戶時區（`general.defaultTimezone`）：週期公告依它計算。 */
  timeZone: string;
}

export async function loadFixtureContext(
  db: ScriptDatabase,
  base: DevSeedBase,
): Promise<DevFixtureContext> {
  // super-admin 是系統角色（db/seeds/roles.ts 的 ROLE_SEED），slug 固定
  const [actor] = await db
    .select({ id: users.id })
    .from(relationTuples)
    .innerJoin(roles, eq(relationTuples.objectId, sql`${roles.id}::text`))
    .innerJoin(users, eq(relationTuples.subjectId, sql`${users.id}::text`))
    .where(
      and(
        isRoleHolderTuple(),
        eq(roles.slug, 'super-admin'),
        isNull(roles.deletedAt),
        isNull(users.deletedAt),
      ),
    )
    .orderBy(asc(users.createdAt))
    .limit(1);

  const active = base.userIds.length
    ? await db
        .select({ id: users.id })
        .from(users)
        .where(
          and(
            inArray(users.id, [...base.userIds]),
            eq(users.status, 'active'),
            eq(users.kind, 'human'),
            isNull(users.deletedAt),
          ),
        )
    : [];

  const [timeZoneRow] = await db
    .select({ value: systemSettings.value })
    .from(systemSettings)
    .where(eq(systemSettings.key, DEFAULT_TIMEZONE_SETTING.key))
    .limit(1);

  // 時區的預設值與 schema 不依賴 env：讀到 env 代表定義改了，要回頭看這裡
  const timeZoneSetting = resolveSetting(DEFAULT_TIMEZONE_SETTING, (key) => {
    throw new Error(`${DEFAULT_TIMEZONE_SETTING.key} 不該依賴 ${key}`);
  });
  const storedTimeZone = timeZoneSetting.schema.safeParse(timeZoneRow?.value);

  return {
    ...base,
    now: new Date(),
    actorId: actor?.id ?? null,
    activeUserIds: new Set(active.map((row) => row.id)),
    timeZone: storedTimeZone.success ? storedTimeZone.data : timeZoneSetting.defaultValue,
  };
}

/** 群組的成員（沿巢狀群組往下展開，只取使用者 id）；與公告解析受眾的「群組」來源相同的走法。 */
export async function expandGroupMembers(
  db: ScriptDatabase,
  groupIds: readonly string[],
): Promise<Set<string>> {
  const userIds = new Set<string>();
  const visited = new Set<string>();
  let frontier = [...groupIds];
  while (frontier.length) {
    for (const id of frontier) visited.add(id);
    // oxlint-disable-next-line no-await-in-loop -- 一層一層往下展開，巢狀最多 3 層
    const edges = await db
      .select({ subjectType: relationTuples.subjectType, subjectId: relationTuples.subjectId })
      .from(relationTuples)
      .where(and(isGroupMemberTuple(), inArray(relationTuples.objectId, frontier)));
    const next: string[] = [];
    for (const edge of edges) {
      if (edge.subjectType === USER_SUBJECT_TYPE) userIds.add(edge.subjectId);
      else if (edge.subjectType === GROUP_OBJECT_TYPE && !visited.has(edge.subjectId)) {
        next.push(edge.subjectId);
      }
    }
    frontier = next;
  }
  return userIds;
}
