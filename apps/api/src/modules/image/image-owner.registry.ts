import { Injectable, Logger } from '@nestjs/common';

/**
 * 使用圖片資產的資源種類（docs/architecture/backend/25-image.md §15.8）：由 consumer 在 `onModuleInit` 以
 * `ImageAssetService.registerOwner()` 登記。`modules/image` 不認識 consumer，處理好新的版本時經由這裡通知它推自己的資源變更。
 */
export interface ImageOwnerDefinition {
  /** 例：`user`（`image_assets.owner_type`）。 */
  ownerType: string;
  /** 交易提交後：這個資源的圖片有了新的版本（第一次處理好、或重新裁切），推自己的資源變更讓畫面重抓。 */
  onImageReady(ownerId: string): void | Promise<void>;
}

@Injectable()
export class ImageOwnerRegistry {
  private readonly logger = new Logger(ImageOwnerRegistry.name);
  private readonly owners = new Map<string, ImageOwnerDefinition>();

  register(definition: ImageOwnerDefinition): void {
    if (this.owners.has(definition.ownerType)) {
      throw new Error(`圖片資產的擁有者 ${definition.ownerType} 重複登記`);
    }
    this.owners.set(definition.ownerType, definition);
  }

  /** 通知擁有者；失敗只記錄（推播是加分，不影響處理的結果）。 */
  async notifyReady(ownerType: string, ownerId: string): Promise<void> {
    const owner = this.owners.get(ownerType);
    if (!owner) return;
    try {
      await owner.onImageReady(ownerId);
    } catch (error) {
      this.logger.warn({ err: error, ownerType, ownerId }, '通知圖片的擁有者失敗');
    }
  }
}
