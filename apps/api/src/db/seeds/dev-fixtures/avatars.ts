import { and, eq, inArray, isNull } from 'drizzle-orm';

import { uploadKeyOf } from '@/modules/image/image.constants';

import type { ScriptDatabase } from '../../client';
import { imageAssets, users } from '../../schema';
import type { DevFixtureContext } from './context';
import { fixtureId } from './context';
import type { PhotoSpec } from './images';
import { photoContentType, renderPhoto } from './images';
import { addSeedStorageUsage, enqueueOutbox, SEED_JOB } from './media-common';
import type { SeedStorage } from './storage';

/**
 * 頭像（docs/architecture/backend/25-image.md §15.8）：部分 dev 使用者的頭像是一筆圖片資產（用途 `user.avatar`）。
 * 與本人上傳後按儲存的結果相同：資產由本人建立（出現在他的「最近使用」）、已被他認領、`users.avatar_image_id` 指向它；
 * 物件放在 `images/<id>/upload`，由 api 的 worker 以 `image.process` 寫主檔與裁成正方形的變體（§15.5）。
 */

/**
 * 用途 id：與 `modules/user/user-avatar.service.ts` 的 `USER_AVATAR_USAGE`、擁有者類型 `USER_OWNER_TYPE` 相同。
 * 那是要注入的 service，seed 不 import（docs/coding-standards/07-layer-dependencies.md §3.2 註 3）；單元測試對照。
 */
export const AVATAR_USAGE = 'user.avatar';
export const AVATAR_OWNER_TYPE = 'user';

/** 有頭像的 dev 使用者序號：前半是正方形、後半是長方形（沒給裁切，取中央）。 */
export const AVATAR_USERS = [1, 2, 3, 4, 5, 6, 13, 14, 21, 22, 30] as const;

export function avatarSpec(serial: number): PhotoSpec {
  const square = serial % 2 === 1;
  return {
    width: square ? 512 : 640,
    height: square ? 512 : 480,
    format: serial % 3 === 0 ? 'png' : 'jpeg',
    seed: 200 + serial,
    label: `D${String(serial).padStart(2, '0')}`,
  };
}

function assetIdOf(serial: number): string {
  return fixtureId(`avatar:dev${serial}`);
}

export interface AvatarFixtureResult {
  users: number;
  created: number;
}

export async function seedAvatarFixtures(
  db: ScriptDatabase,
  ctx: DevFixtureContext,
  storage: SeedStorage,
): Promise<AvatarFixtureResult> {
  const targets = AVATAR_USERS.flatMap((serial) => {
    const userId = ctx.userIds[serial - 1];
    return userId ? [{ serial, userId }] : [];
  });
  if (targets.length === 0) return { users: 0, created: 0 };

  const existing = new Set(
    (
      await db
        .select({ id: imageAssets.id })
        .from(imageAssets)
        .where(
          inArray(
            imageAssets.id,
            targets.map((target) => assetIdOf(target.serial)),
          ),
        )
    ).map((row) => row.id),
  );
  // 已經有頭像的人（自己換過）不動；物件也不寫，免得留下沒有資產的物件
  const withoutAvatar = new Set(
    (
      await db
        .select({ id: users.id })
        .from(users)
        .where(
          and(
            inArray(
              users.id,
              targets.map((target) => target.userId),
            ),
            isNull(users.avatarImageId),
            isNull(users.deletedAt),
          ),
        )
    ).map((row) => row.id),
  );

  let created = 0;
  for (const { serial, userId } of targets) {
    const assetId = assetIdOf(serial);
    if (existing.has(assetId) || !withoutAvatar.has(userId)) continue;
    const spec = avatarSpec(serial);
    // oxlint-disable-next-line no-await-in-loop -- 依序產生，筆數少
    const data = await renderPhoto(spec);
    // oxlint-disable-next-line no-await-in-loop -- 同上
    await storage.put(uploadKeyOf(assetId), data, photoContentType(spec.format));
    // oxlint-disable-next-line no-await-in-loop -- 同上
    const inserted = await db.transaction(async (tx) => {
      // 先鎖住使用者列：只在他還沒有頭像時認領（UserAvatarService.applyInTx 的順序）
      const [user] = await tx
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.id, userId), isNull(users.avatarImageId), isNull(users.deletedAt)))
        .for('update');
      if (!user) return false;
      const [row] = await tx
        .insert(imageAssets)
        .values({
          id: assetId,
          usage: AVATAR_USAGE,
          status: 'pending',
          source: 'upload',
          sourceName: `avatar-dev${String(serial).padStart(2, '0')}.${spec.format === 'png' ? 'png' : 'jpg'}`,
          contentType: photoContentType(spec.format),
          size: data.length,
          queuedAt: ctx.now,
          ownerType: AVATAR_OWNER_TYPE,
          ownerId: userId,
          createdAt: ctx.now,
          createdBy: userId,
          updatedAt: ctx.now,
        })
        .onConflictDoNothing()
        .returning({ id: imageAssets.id });
      if (!row) return false;
      await tx.update(users).set({ avatarImageId: assetId }).where(eq(users.id, userId));
      await addSeedStorageUsage(tx, data.length);
      await enqueueOutbox(tx, SEED_JOB.IMAGE_PROCESS, [{ assetId }]);
      return true;
    });
    if (inserted) created += 1;
  }
  return { users: targets.length, created };
}
