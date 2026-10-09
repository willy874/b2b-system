import { Injectable } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';

import { CdnPathResolver } from '@/core/storage';

import { fileVariantKeysOf } from './file.constants';
import { FileRepository } from './file.repository';

/**
 * 檔案的影像變體（`fileVariant`）在手動清理時列出哪些路徑（docs/architecture/backend/09-file.md §16.11）。
 * 回收桶裡的檔案也算（下架的需求常常發生在刪除之後）；永久刪除之後紀錄不在，回 404，改用路徑清理。
 */
@Injectable()
export class FileCdnPaths implements OnModuleInit {
  constructor(
    private readonly resolver: CdnPathResolver,
    private readonly files: FileRepository,
  ) {}

  onModuleInit(): void {
    this.resolver.register('fileVariant', (id) => this.keysOf(id));
  }

  async keysOf(id: string): Promise<string[] | null> {
    const file = (await this.files.findById(id)) ?? (await this.files.findDeletedById(id));
    return file ? fileVariantKeysOf(id) : null;
  }
}
