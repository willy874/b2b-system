import type { ScriptDatabase } from '../../client';
import { seedAnnouncementFixtures } from './announcements';
import { seedAvatarFixtures } from './avatars';
import type { DevFixtureContext, DevSeedBase } from './context';
import { loadFixtureContext } from './context';
import { seedMediaFileFixtures } from './files';
import { seedGalleryFixtures } from './gallery';
import { seedNotificationFixtures } from './notifications';
import { seedOrganizationFixtures } from './organization';
import type { SeedStorage } from './storage';
import { seedTagFixtures } from './tags';
import { seedTrashFixtures } from './trash';
import { seedWebhookFixtures } from './webhooks';

export { createRandom } from './context';
export type { DevSeedBase } from './context';
export { connectSeedStorage } from './storage';
export type { SeedStorage } from './storage';

/**
 * dev seed 的第二段：讓通知總覽、公告、回收桶、Webhook、標籤管理、組織這幾頁有資料可看。
 * 每一筆都用固定 id（`fixtureId`）寫入、`ON CONFLICT DO NOTHING`：重跑不重複，已存在的列（含被人改過的）不覆寫。
 * 順序有依賴：回收桶建立資料夾（標籤貼在上面）→ 標籤 → Webhook（自動停用的那一個要發通知）→ 公告 → 其他通知。
 *
 * 有物件儲存（`storage`）時再寫檔案、圖片庫與頭像：物件真的寫入，變體由 api 的 worker 處理（`job_outbox`）。
 * 沒有時略過這三項（連不上 file-storage），其他照常。
 */
export async function seedDevFixtures(
  db: ScriptDatabase,
  base: DevSeedBase,
  storage?: SeedStorage,
): Promise<string[]> {
  const ctx = await loadFixtureContext(db, base);
  if (!ctx.actorId) {
    console.warn(
      '找不到 super-admin：假資料的建立者與刪除者會是空的（先跑 db:seed 再跑 db:seed:dev）',
    );
  }

  const trash = await seedTrashFixtures(db, ctx);
  const tags = await seedTagFixtures(db, ctx, trash.activeFolderIds);
  const webhooks = await seedWebhookFixtures(db, ctx);
  const announcements = await seedAnnouncementFixtures(db, ctx);
  const notifications = await seedNotificationFixtures(db, ctx);
  const organization = await seedOrganizationFixtures(db, ctx);

  const mediaSummary = storage
    ? await seedMediaFixtures(db, ctx, storage)
    : ['檔案管理、圖片庫、頭像：略過（連不上物件儲存）'];

  return [
    `回收桶：使用者 ${trash.users}、角色 ${trash.roles}、群組 ${trash.groups}、資料夾 ${trash.folders}、檔案 ${trash.files}、公告 1`,
    `標籤：${tags.tags} 個、指派 ${tags.assignments} 筆`,
    `Webhook：${webhooks.subscriptions} 個訂閱、${webhooks.events} 個事件、${webhooks.deliveries} 筆投遞紀錄`,
    `公告：${announcements.announcements} 則（本次新寫入 ${announcements.dispatches} 次發送、${announcements.notifications} 則公告通知）`,
    `其他通知：本次新寫入 ${notifications} 則`,
    `組織：${organization.units} 個部門（含 1 個在回收桶）、本次新寫入 ${organization.members} 筆成員資格`,
    ...mediaSummary,
  ];
}

/** 檔案 → 圖片庫 → 頭像：都要寫物件儲存，變體交給 api 的 worker。 */
async function seedMediaFixtures(
  db: ScriptDatabase,
  ctx: DevFixtureContext,
  storage: SeedStorage,
): Promise<string[]> {
  const files = await seedMediaFileFixtures(db, ctx, storage);
  const gallery = await seedGalleryFixtures(db, ctx, storage);
  const avatars = await seedAvatarFixtures(db, ctx, storage);
  return [
    `檔案管理：${files.folders} 個資料夾、${files.files} 個檔案（照片、PDF、SVG；本次新寫入 ${files.created}）`,
    `圖片庫：${gallery.total} 張（${gallery.deleted} 張在回收桶；本次新寫入 ${gallery.created}）、${gallery.albums} 個相簿、` +
      `本次貼標籤 ${gallery.tags} 筆、留言 ${gallery.comments} 則`,
    `頭像：${avatars.users} 位 dev 使用者（本次新寫入 ${avatars.created}）`,
    '變體由 api 的 worker 產生：job_outbox 由定期清掃（JOBS_OUTBOX_SWEEP_CRON，預設每 10 分鐘）搬進佇列，處理完才出現在圖片庫',
  ];
}
