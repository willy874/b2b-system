import { and, isNull, sql } from 'drizzle-orm';

import { storageKeyOf } from '@/modules/file/file.constants';

import { recordRoleBaseline } from '../../bootstrap';
import type { ScriptDatabase } from '../../client';
import {
  fileFolders,
  files,
  fileStorageUsage,
  groupMemberTuple,
  groups,
  relationTuples,
  rolePermissionTuple,
  roles,
  users,
} from '../../schema';
import type { PermissionKey } from '../permissions';
import type { DevFixtureContext } from './context';
import { ago, fixtureId } from './context';

/**
 * 回收桶（docs/architecture/backend/13-trash.md）：直接寫入「已軟刪除」的列，各類型都有幾筆。
 * 刪除時間落在 1～12 天前，都在預設保留期（`trash.retentionDays` 30 天）內；過期被永久刪除後，重跑 seed 會再補回來。
 * 刪除者取自 `updated_by`（各 repository 的 `listDeleted`），所以寫成操作者。
 *
 * 另外建立幾個 **未刪除** 的資料夾（檔案標籤要貼在它們上面）：同名的資料夾已存在時沿用它。
 */

const DELETED_USERS = [
  { key: 'former01', displayName: '林志明', status: 'inactive', daysAgo: 2 },
  { key: 'former02', displayName: '黃雅婷', status: 'active', daysAgo: 5 },
  { key: 'former03', displayName: '張家豪', status: 'inactive', daysAgo: 11 },
] as const;

const DELETED_ROLES: {
  slug: string;
  name: string;
  description: string;
  keys: PermissionKey[];
  daysAgo: number;
}[] = [
  {
    slug: 'temp-project-collab',
    name: '臨時專案協作',
    description: '專案結束後停用的協作權限',
    keys: ['user:read', 'file:read'],
    daysAgo: 3,
  },
  {
    slug: 'legacy-support-lead',
    name: '舊版客服主管',
    description: '組織調整前的客服主管角色',
    keys: ['user:read', 'role:read'],
    daysAgo: 9,
  },
];

/** `members` 是 dev 使用者的序號（1 起算）。 */
const DELETED_GROUPS = [
  { name: '2025 暑期實習生', description: '實習結束，暫時保留名單', members: [46, 47], daysAgo: 4 },
  { name: '辦公室搬遷小組', description: null, members: [], daysAgo: 8 },
] as const;

/** 未刪除的資料夾（根目錄）。名稱避開導覽截圖的示範資料（apps/e2e/tour/demo-data.ts）。 */
export const ACTIVE_FOLDERS = ['專案文件', '教育訓練教材', '對外簡報'] as const;
export type ActiveFolderName = (typeof ACTIVE_FOLDERS)[number];

interface DeletedFileSeed {
  key: string;
  name: string;
  contentType: string;
  size: number;
}

/** 整個資料夾一起刪除：回收桶只列出根資料夾，裡面的子資料夾與檔案帶同一個 `deletion_id`。 */
const DELETED_FOLDER_TREE = {
  key: 'folder:2025-events',
  name: '2025 年度活動',
  daysAgo: 6,
  photoFolder: { key: 'folder:2025-events/photos', name: '活動照片' },
  files: [
    {
      key: 'file:2025-events/plan',
      name: '活動企劃書.pdf',
      contentType: 'application/pdf',
      size: 482_133,
    },
    {
      key: 'file:2025-events/budget',
      name: '預算表.xlsx',
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      size: 38_912,
    },
  ] satisfies DeletedFileSeed[],
  photoFiles: [
    {
      key: 'file:2025-events/photo-1',
      name: 'IMG_0412.jpg',
      contentType: 'image/jpeg',
      size: 2_351_004,
    },
    {
      key: 'file:2025-events/photo-2',
      name: 'IMG_0413.jpg',
      contentType: 'image/jpeg',
      size: 2_118_772,
    },
  ] satisfies DeletedFileSeed[],
};

/** 個別刪除的檔案：`folder` 是所在的未刪除資料夾（null＝根目錄）。 */
const DELETED_FILES: (DeletedFileSeed & { folder: ActiveFolderName | null; daysAgo: number })[] = [
  {
    key: 'file:quote-v1',
    name: '舊版報價單.xlsx',
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    size: 24_576,
    folder: '專案文件',
    daysAgo: 1,
  },
  {
    key: 'file:minutes-draft',
    name: '會議記錄_草稿.docx',
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    size: 18_240,
    folder: '專案文件',
    daysAgo: 7,
  },
  {
    key: 'file:logo-old',
    name: 'logo_舊版.png',
    contentType: 'image/png',
    size: 96_310,
    folder: null,
    daysAgo: 10,
  },
];

export interface TrashFixtureResult {
  users: number;
  roles: number;
  groups: number;
  folders: number;
  files: number;
  /** 未刪除的資料夾名稱 → id（給標籤用）。 */
  activeFolderIds: Map<ActiveFolderName, string>;
}

export async function seedTrashFixtures(
  db: ScriptDatabase,
  ctx: DevFixtureContext,
): Promise<TrashFixtureResult> {
  const { now, actorId } = ctx;

  // ── 使用者 ───────────────────────────────────────────
  // email 不用 dev<NN>：dev.ts 以「未刪除的 dev<NN>」判斷要不要建立，軟刪除它們會讓重跑時再建一個
  for (const seed of DELETED_USERS) {
    const deletedAt = ago(now, seed.daysAgo);
    // oxlint-disable-next-line no-await-in-loop -- seed 腳本，筆數少，依序執行
    await db
      .insert(users)
      .values({
        id: fixtureId(`user:${seed.key}`),
        email: `${seed.key}@dev.local`,
        username: seed.key,
        displayName: seed.displayName,
        status: seed.status,
        // 軟刪除遞增 token_version（UserRepository.softDelete）
        tokenVersion: 1,
        createdAt: ago(now, 120 + seed.daysAgo),
        createdBy: actorId,
        updatedAt: deletedAt,
        updatedBy: actorId,
        deletedAt,
      })
      .onConflictDoNothing();
  }

  // ── 角色：權限鍵與第 1 版一起寫，還原後就是完整的角色 ─────────
  for (const seed of DELETED_ROLES) {
    const deletedAt = ago(now, seed.daysAgo);
    // oxlint-disable-next-line no-await-in-loop -- 同上
    const [created] = await db
      .insert(roles)
      .values({
        id: fixtureId(`role:${seed.slug}`),
        slug: seed.slug,
        name: seed.name,
        description: seed.description,
        isSystem: false,
        createdAt: ago(now, 60 + seed.daysAgo),
        createdBy: actorId,
        updatedAt: deletedAt,
        updatedBy: actorId,
        deletedAt,
      })
      .onConflictDoNothing()
      .returning();
    if (!created) continue;
    // oxlint-disable-next-line no-await-in-loop -- 同上
    await db
      .insert(relationTuples)
      .values(seed.keys.map((key) => rolePermissionTuple(created.id, key)))
      .onConflictDoNothing();
    // oxlint-disable-next-line no-await-in-loop -- 同上
    await recordRoleBaseline(db, created, seed.keys);
  }

  // ── 群組：成員的邊保留（休眠），還原時一起回來 ───────────────
  for (const seed of DELETED_GROUPS) {
    const deletedAt = ago(now, seed.daysAgo);
    // oxlint-disable-next-line no-await-in-loop -- 同上
    const [created] = await db
      .insert(groups)
      .values({
        id: fixtureId(`group:${seed.name}`),
        name: seed.name,
        description: seed.description,
        createdAt: ago(now, 90 + seed.daysAgo),
        createdBy: actorId,
        updatedAt: deletedAt,
        updatedBy: actorId,
        deletedAt,
      })
      .onConflictDoNothing()
      .returning({ id: groups.id });
    const members = seed.members
      .map((serial) => ctx.userIds[serial - 1])
      .filter((id): id is string => Boolean(id));
    if (!created || members.length === 0) continue;
    // oxlint-disable-next-line no-await-in-loop -- 同上
    await db
      .insert(relationTuples)
      .values(members.map((id) => groupMemberTuple(created.id, { type: 'user', id }, actorId)))
      .onConflictDoNothing();
  }

  // ── 資料夾與檔案 ─────────────────────────────────────
  const activeFolderIds = new Map<ActiveFolderName, string>();
  for (const name of ACTIVE_FOLDERS) {
    // oxlint-disable-next-line no-await-in-loop -- 同上
    activeFolderIds.set(name, await ensureRootFolder(db, ctx, name));
  }

  const tree = DELETED_FOLDER_TREE;
  const treeDeletedAt = ago(now, tree.daysAgo);
  const treeDeletionId = fixtureId(`deletion:${tree.key}`);
  const rootFolderId = fixtureId(tree.key);
  const photoFolderId = fixtureId(tree.photoFolder.key);
  const folderRows = [
    { id: rootFolderId, name: tree.name, parentId: null },
    { id: photoFolderId, name: tree.photoFolder.name, parentId: rootFolderId },
  ];
  const folderStamp = {
    kind: 'normal' as const,
    deletionId: treeDeletionId,
    createdAt: ago(now, 200),
    createdBy: actorId,
    updatedAt: treeDeletedAt,
    updatedBy: actorId,
    deletedAt: treeDeletedAt,
  };
  // 一次 INSERT 多列：子資料夾的外鍵指向同一句寫入的父層
  await db
    .insert(fileFolders)
    .values(folderRows.map((row) => Object.assign({}, folderStamp, row)))
    .onConflictDoNothing();

  const fileRows: {
    file: DeletedFileSeed;
    folderId: string | null;
    deletionId: string;
    deletedAt: Date;
  }[] = [
    ...tree.files.map((file) => ({
      file,
      folderId: rootFolderId,
      deletionId: treeDeletionId,
      deletedAt: treeDeletedAt,
    })),
    ...tree.photoFiles.map((file) => ({
      file,
      folderId: photoFolderId,
      deletionId: treeDeletionId,
      deletedAt: treeDeletedAt,
    })),
    ...DELETED_FILES.map((file) => ({
      file,
      folderId: file.folder ? (activeFolderIds.get(file.folder) ?? null) : null,
      // 個別刪除：自己一批
      deletionId: fixtureId(`deletion:${file.key}`),
      deletedAt: ago(now, file.daysAgo),
    })),
  ];
  const insertedFiles = await db
    .insert(files)
    .values(
      fileRows.map(({ file, folderId, deletionId, deletedAt }) => {
        const id = fixtureId(file.key);
        const uploadedAt = ago(now, 30);
        return {
          id,
          name: file.name,
          contentType: file.contentType,
          size: file.size,
          // 物件儲存裡 **沒有** 這些物件：只是回收桶的列表資料，還原後下載會失敗
          storageKey: storageKeyOf(id),
          etag: fixtureId(`etag:${file.key}`).replaceAll('-', ''),
          status: 'ready' as const,
          uploadedAt,
          folderId,
          deletionId,
          createdAt: uploadedAt,
          createdBy: actorId,
          updatedAt: deletedAt,
          updatedBy: actorId,
          deletedAt,
        };
      }),
    )
    .onConflictDoNothing()
    .returning({ size: files.size });

  // 已用量是 `files.size` 的合計（含回收桶裡的，09-file.md §5.0）；只加這次真的寫入的列
  const addedBytes = insertedFiles.reduce((sum, row) => sum + row.size, 0);
  if (addedBytes > 0) {
    await db
      .insert(fileStorageUsage)
      .values({ id: true, usedBytes: addedBytes })
      .onConflictDoUpdate({
        target: fileStorageUsage.id,
        set: { usedBytes: sql`${fileStorageUsage.usedBytes} + ${addedBytes}` },
      });
  }

  return {
    users: DELETED_USERS.length,
    roles: DELETED_ROLES.length,
    groups: DELETED_GROUPS.length,
    // 回收桶只列出根資料夾
    folders: 1,
    // 回收桶列出的檔案：個別刪除的（資料夾裡的跟著資料夾，不另外列）
    files: DELETED_FILES.length,
    activeFolderIds,
  };
}

/** 根目錄底下未刪除的一般資料夾：同名的已存在（不分大小寫）就沿用，否則以固定 id 建立。 */
async function ensureRootFolder(
  db: ScriptDatabase,
  ctx: DevFixtureContext,
  name: string,
): Promise<string> {
  const findExisting = async (): Promise<string | undefined> => {
    const [row] = await db
      .select({ id: fileFolders.id })
      .from(fileFolders)
      .where(
        and(
          isNull(fileFolders.parentId),
          sql`lower(${fileFolders.name}) = lower(${name})`,
          isNull(fileFolders.deletedAt),
        ),
      )
      .limit(1);
    return row?.id;
  };
  const existing = await findExisting();
  if (existing) return existing;
  const id = fixtureId(`folder:${name}`);
  await db
    .insert(fileFolders)
    .values({
      id,
      name,
      kind: 'normal',
      createdAt: ago(ctx.now, 45),
      createdBy: ctx.actorId,
      updatedAt: ago(ctx.now, 45),
      updatedBy: ctx.actorId,
    })
    .onConflictDoNothing();
  return (await findExisting()) ?? id;
}
