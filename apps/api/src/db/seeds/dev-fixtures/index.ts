import type { ScriptDatabase } from '../../client';
import { seedAnnouncementFixtures } from './announcements';
import type { DevSeedBase } from './context';
import { loadFixtureContext } from './context';
import { seedNotificationFixtures } from './notifications';
import { seedTagFixtures } from './tags';
import { seedTrashFixtures } from './trash';
import { seedWebhookFixtures } from './webhooks';

export { createRandom } from './context';
export type { DevSeedBase } from './context';

/**
 * dev seed 的第二段：讓通知總覽、公告、回收桶、Webhook、標籤管理這幾頁有資料可看。
 * 每一筆都用固定 id（`fixtureId`）寫入、`ON CONFLICT DO NOTHING`：重跑不重複，已存在的列（含被人改過的）不覆寫。
 * 順序有依賴：回收桶建立資料夾（標籤貼在上面）→ 標籤 → Webhook（自動停用的那一個要發通知）→ 公告 → 其他通知。
 */
export async function seedDevFixtures(db: ScriptDatabase, base: DevSeedBase): Promise<string[]> {
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

  return [
    `回收桶：使用者 ${trash.users}、角色 ${trash.roles}、群組 ${trash.groups}、資料夾 ${trash.folders}、檔案 ${trash.files}、公告 1`,
    `標籤：${tags.tags} 個、指派 ${tags.assignments} 筆`,
    `Webhook：${webhooks.subscriptions} 個訂閱、${webhooks.events} 個事件、${webhooks.deliveries} 筆投遞紀錄`,
    `公告：${announcements.announcements} 則（本次新寫入 ${announcements.dispatches} 次發送、${announcements.notifications} 則公告通知）`,
    `其他通知：本次新寫入 ${notifications} 則`,
  ];
}
