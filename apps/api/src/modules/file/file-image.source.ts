import { Injectable } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';

import { ImageSourceRegistry } from '@/modules/image/image-source.registry';

import { FileService } from './file.service';

/** 圖片來源的 id（前端 `features/file` 的選圖分頁送來的 `source`）。 */
export const FILE_IMAGE_SOURCE = 'file';

/**
 * 檔案管理器是圖片的一個來源（docs/architecture/backend/25-image.md §15.10）：頭像等從這裡挑圖時，
 * 以呼叫者的身分讀取（看得到所在的資料夾），呼叫端把物件 **複製** 成自己的一份——原檔之後被改名、移動、刪除，
 * 或資料夾的授權改變，都不影響複製出去的圖，看那張圖的人也看不到原本的資料夾。屬於可關閉的 feature `file`。
 */
@Injectable()
export class FileImageSource implements OnModuleInit {
  constructor(
    private readonly sources: ImageSourceRegistry,
    private readonly files: FileService,
  ) {}

  onModuleInit(): void {
    this.sources.register({
      id: FILE_IMAGE_SOURCE,
      feature: 'file',
      resolve: async (refId, actor, purpose) => {
        const file = await this.files.resolveImageForCopy(refId, actor, purpose);
        return {
          storageKey: file.storageKey,
          contentType: file.contentType,
          size: file.size,
          name: file.name,
          width: file.imageWidth ?? undefined,
          height: file.imageHeight ?? undefined,
        };
      },
    });
  }
}
