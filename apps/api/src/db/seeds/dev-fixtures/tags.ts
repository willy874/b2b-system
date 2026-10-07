import { and, eq, sql } from 'drizzle-orm';

import { RESOURCE_TYPE } from '@/core/resource';

import type { ScriptDatabase } from '../../client';
import { resourceTags, tags } from '../../schema';
import type { TagColor } from '../../schema';
import type { DevFixtureContext } from './context';
import { ago, fixtureId } from './context';
import type { ActiveFolderName } from './trash';

/**
 * 標籤（docs/architecture/backend/18-tag.md）：使用者與檔案兩個標籤組各幾個，並貼到 dev 使用者與資料夾上。
 * 名稱避開導覽截圖以 API 建立的標籤（apps/e2e/tour/demo-data.ts），否則那邊的建立會撞到同名而失敗。
 */

/**
 * 標籤組：與 `modules/user/user-tag.resource.ts`、`modules/file/file-tag.resource.ts` 登記的值相同。
 * 那兩個檔案是要注入 service 的 provider，seed 不 import（docs/coding-standards/07-layer-dependencies.md §3.2 註 3）。
 */
const USER_TAG_SCOPE = 'user';
const FILE_TAG_SCOPE = 'file';

/** `users` 是貼上這個標籤的 dev 使用者序號（1 起算）。 */
const USER_TAGS: { name: string; color: TagColor; users: number[] }[] = [
  { name: 'VIP 窗口', color: 'brand', users: [1, 4, 14, 21] },
  { name: '新進同仁', color: 'success', users: [9, 10, 11, 25, 26] },
  { name: '需要追蹤', color: 'warning', users: [3, 15, 17, 36] },
  { name: '交接中', color: 'danger', users: [27, 37] },
  { name: '兼職', color: 'neutral', users: [19, 20, 44] },
  // 沒有人用的標籤：管理頁的「使用數 0」
  { name: '年度評核', color: 'neutral', users: [] },
];

const FILE_TAGS: { name: string; color: TagColor; folders: ActiveFolderName[] }[] = [
  { name: '機密', color: 'danger', folders: ['專案文件'] },
  { name: '對外公開', color: 'success', folders: ['對外簡報'] },
  { name: '範本', color: 'brand', folders: ['教育訓練教材', '對外簡報'] },
  { name: '封存', color: 'neutral', folders: [] },
];

export interface TagFixtureResult {
  tags: number;
  assignments: number;
}

export async function seedTagFixtures(
  db: ScriptDatabase,
  ctx: DevFixtureContext,
  folderIds: ReadonlyMap<ActiveFolderName, string>,
): Promise<TagFixtureResult> {
  let assignments = 0;

  for (const [index, seed] of USER_TAGS.entries()) {
    // oxlint-disable-next-line no-await-in-loop -- seed 腳本，筆數少，依序執行
    const tagId = await ensureTag(db, ctx, USER_TAG_SCOPE, seed.name, seed.color, index);
    const userIds = seed.users
      .map((serial) => ctx.userIds[serial - 1])
      .filter((id): id is string => Boolean(id));
    // oxlint-disable-next-line no-await-in-loop -- 同上
    assignments += await assign(db, ctx, tagId, RESOURCE_TYPE.USER, userIds);
  }

  for (const [index, seed] of FILE_TAGS.entries()) {
    // oxlint-disable-next-line no-await-in-loop -- 同上
    const tagId = await ensureTag(db, ctx, FILE_TAG_SCOPE, seed.name, seed.color, index);
    const ids = seed.folders
      .map((name) => folderIds.get(name))
      .filter((id): id is string => Boolean(id));
    // oxlint-disable-next-line no-await-in-loop -- 同上
    assignments += await assign(db, ctx, tagId, RESOURCE_TYPE.FILE_FOLDER, ids);
  }

  return { tags: USER_TAGS.length + FILE_TAGS.length, assignments };
}

/** 同一組裡同名（不分大小寫）的標籤已存在就沿用它（可能是有人在畫面上建的）。 */
async function ensureTag(
  db: ScriptDatabase,
  ctx: DevFixtureContext,
  scope: string,
  name: string,
  color: TagColor,
  index: number,
): Promise<string> {
  const createdAt = ago(ctx.now, 40 - index);
  await db
    .insert(tags)
    .values({
      id: fixtureId(`tag:${scope}:${name}`),
      scope,
      name,
      color,
      createdAt,
      createdBy: ctx.actorId,
      updatedAt: createdAt,
      updatedBy: ctx.actorId,
    })
    .onConflictDoNothing();
  const [row] = await db
    .select({ id: tags.id })
    .from(tags)
    .where(and(eq(tags.scope, scope), sql`lower(${tags.name}) = lower(${name})`))
    .limit(1);
  if (!row) throw new Error(`標籤 ${scope}/${name} 建立失敗`);
  return row.id;
}

async function assign(
  db: ScriptDatabase,
  ctx: DevFixtureContext,
  tagId: string,
  resourceType: string,
  resourceIds: readonly string[],
): Promise<number> {
  if (resourceIds.length === 0) return 0;
  await db
    .insert(resourceTags)
    .values(
      resourceIds.map((resourceId) => ({
        tagId,
        resourceType,
        resourceId,
        createdAt: ago(ctx.now, 20),
        createdBy: ctx.actorId,
      })),
    )
    .onConflictDoNothing();
  return resourceIds.length;
}
