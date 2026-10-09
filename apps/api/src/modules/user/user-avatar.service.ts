import { Injectable } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';

import type { AuthUser } from '@/common/types';
import type { DbOrTx, Transaction } from '@/core/database';
import { AppException } from '@/core/errors';
import { DomainEvent, DomainEventBus } from '@/core/events';
import type { ImageSources } from '@/core/image';
import type { ImageCrop, UserRow } from '@/db/schema';
import { ImageAssetService } from '@/modules/image/image-asset.service';
import { RASTER_IMAGE_TYPES } from '@/modules/image/image-usage.registry';

import { userUpdated } from './user.changes';
import { UserRepository } from './user.repository';

/** 頭像的用途 id（`image_assets.usage`；docs/architecture/backend/25-image.md §16.2 D7）。 */
export const USER_AVATAR_USAGE = 'user.avatar';
/** 圖片資產的擁有者種類。 */
const USER_OWNER_TYPE = 'user';

const MIB = 1024 * 1024;

/** 頭像要改成什麼：`imageId` 換一張（`null` 拿掉），只帶 `crop` 是重新裁切目前那張。 */
export interface AvatarChange {
  imageId?: string | null;
  crop?: ImageCrop;
}

/** 寫進 `user.update` 稽核的頭像變更（存參照與來源，不存網址；R1）。 */
export interface AvatarAuditChange {
  before: { avatarImageId: string | null };
  after: {
    avatarImageId: string | null;
    avatarSource?: string;
    avatarSourceRefId?: string | null;
    avatarCrop?: ImageCrop;
  };
}

/**
 * 使用者頭像（第一個 consumer，docs/architecture/backend/25-image.md §15.8）：`users.avatar_image_id` 存圖片資產的 id，
 * 換一張時在同一個交易內認領新的、解除舊的；組回應時以 `ImageAssetService.sourcesOf` 帶網址。
 * 換自己的頭像不需要權限（`PATCH /auth/profile`），換別人的要 `user:update`（`PATCH /users/:id`）。
 */
@Injectable()
export class UserAvatarService implements OnModuleInit {
  constructor(
    private readonly images: ImageAssetService,
    private readonly repo: UserRepository,
    private readonly events: DomainEventBus,
  ) {}

  onModuleInit(): void {
    this.images.registerUsage({
      id: USER_AVATAR_USAGE,
      maxSize: 10 * MIB,
      contentTypes: RASTER_IMAGE_TYPES,
      minWidth: 128,
      minHeight: 128,
      aspectRatio: 1,
      presets: { sm: 32, md: 96, lg: 256 },
      // 低敏感、出現在每一頁：長效期讓頁面開一整天也不破圖（docs/architecture/backend/25-image.md §4 D3）
      urlTtl: 12 * 60 * 60,
      visibility: 'signed',
    });
    this.images.registerOwner({
      ownerType: USER_OWNER_TYPE,
      // 頭像處理好了（第一次、或重新裁切）：看得到這個人的畫面與本人的 profile 重抓
      onImageReady: async (userId) => {
        const roles = await this.repo.listRoles(userId);
        this.events.publish(DomainEvent.RESOURCE_CHANGED, {
          changes: [userUpdated(userId, roles)],
          affectedUserIds: [userId],
        });
      },
    });
  }

  /**
   * 在使用者寫入的交易內套用頭像的變更；回傳要寫進 `users` 的值與稽核的變更（沒有變更回 undefined）。
   * 先鎖住使用者列再讀目前的頭像：同一個人並行換頭像時，被換掉的那張一定會被解除。
   * 呼叫端已確認 `actor` 能改這個人（本人，或有 `user:update`）。
   */
  async applyInTx(
    userId: string,
    change: AvatarChange,
    actor: AuthUser,
    tx: Transaction,
  ): Promise<{ avatarImageId: string | null; audit: AvatarAuditChange } | undefined> {
    if (change.imageId === undefined && !change.crop) return undefined;
    const locked = await this.repo.lockAvatar(userId, tx);
    if (!locked) throw new AppException('USER_NOT_FOUND');
    const user = { id: userId, avatarImageId: locked.avatarImageId };
    const owner = { ownerType: USER_OWNER_TYPE, ownerId: user.id };
    const current = user.avatarImageId;
    const { imageId, crop } = change;

    if (imageId === undefined || imageId === current) {
      if (!crop) return undefined;
      // 只改裁切：重新裁切目前那張，不必重傳
      if (!current)
        throw new AppException('VALIDATION_FAILED', { fields: { avatarCrop: 'no avatar' } });
      await this.images.recrop(current, owner, crop, tx);
      return {
        avatarImageId: current,
        audit: {
          before: { avatarImageId: current },
          after: { avatarImageId: current, avatarCrop: crop },
        },
      };
    }

    if (current) await this.images.detach(current, owner, tx);
    if (imageId === null) {
      return {
        avatarImageId: null,
        audit: { before: { avatarImageId: current }, after: { avatarImageId: null } },
      };
    }
    const claimed = await this.images.claim(imageId, owner, USER_AVATAR_USAGE, crop, actor, tx);
    const source = this.images.describeSource(claimed);
    return {
      avatarImageId: imageId,
      audit: {
        before: { avatarImageId: current },
        after: {
          avatarImageId: imageId,
          avatarSource: source.source,
          avatarSourceRefId: source.sourceRefId,
          ...(crop ? { avatarCrop: crop } : {}),
        },
      },
    };
  }

  /** 使用者被永久刪除：他的頭像交給圖片資產的清理排程（回收桶的 purge 交易內）。 */
  async releaseAll(userId: string, tx: DbOrTx): Promise<void> {
    await this.images.detachAll({ ownerType: USER_OWNER_TYPE, ownerId: userId }, tx);
  }

  /** 組回應用：每個人的頭像（沒有、還在處理的是 `null`）。 */
  async avatarsOf(
    rows: readonly Pick<UserRow, 'id' | 'avatarImageId'>[],
  ): Promise<Map<string, ImageSources | null>> {
    const sources = await this.images.sourcesOf(rows.map((row) => row.avatarImageId));
    return new Map(
      rows.map((row) => [
        row.id,
        row.avatarImageId ? (sources.get(row.avatarImageId) ?? null) : null,
      ]),
    );
  }

  /** 一個人的頭像。 */
  async avatarOf(row: Pick<UserRow, 'id' | 'avatarImageId'>): Promise<ImageSources | null> {
    return (await this.avatarsOf([row])).get(row.id) ?? null;
  }
}
