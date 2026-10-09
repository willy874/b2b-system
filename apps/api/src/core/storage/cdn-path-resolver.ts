import { Injectable } from '@nestjs/common';

import { AppException } from '../errors';
import { requireTenant, Tenancy } from '../tenant';
import type { CdnResource } from './cdn-resource';
import { cdnPathOf } from './cdn-url-signer';

/**
 * 擁有者模組的解析函式：在那個租戶的脈絡裡（`Tenancy.runForMaintenance`）列出一筆資源 **曾經有過** 的所有物件 key
 * （含已刪除、舊版本的變體；擁有者記得 key 的規則，不需要物件還在）。找不到那筆資源回 `null`。
 */
export type CdnPathResolverFn = (id: string) => Promise<readonly string[] | null>;

/** 解析的結果：邊緣上的完整路徑（`/storage/<bucket>/<key>`）。 */
export interface ResolvedCdnPaths {
  paths: string[];
}

/**
 * 手動清理的「依資源列出路徑」（docs/architecture/backend/09-file.md §16.11）。`core/storage` 不認識業務的 key 規則：
 * 擁有者模組在 `onModuleInit` 以 `register(資源類型, 解析函式)` 登記（`file` 登記 `fileVariant`、`image` 登記 `imageAsset`；
 * 之後的圖片庫登記 `galleryItem`）。沒有登記的資源類型與找不到的資源一樣回 `404 CDN_PURGE_TARGET_NOT_FOUND`。
 */
@Injectable()
export class CdnPathResolver {
  private readonly resolvers = new Map<CdnResource, CdnPathResolverFn>();

  constructor(private readonly tenancy: Tenancy) {}

  /** 同一種資源只能登記一次（兩個模組都說自己擁有它，代表 key 的規則畫錯了）。 */
  register(resource: CdnResource, resolve: CdnPathResolverFn): void {
    if (this.resolvers.has(resource)) {
      throw new Error(`CDN 資源類型 ${resource} 的路徑解析器已經登記過`);
    }
    this.resolvers.set(resource, resolve);
  }

  /** 已登記的資源類型（頁面的目標選單只列出它們）。 */
  registered(): CdnResource[] {
    return [...this.resolvers.keys()];
  }

  /** 進入租戶、列出那筆資源的所有路徑（已去重、加上那個租戶的 bucket）。 */
  async resolve(tenantId: string, resource: CdnResource, id: string): Promise<ResolvedCdnPaths> {
    const resolve = this.resolvers.get(resource);
    if (!resolve) throw new AppException('CDN_PURGE_TARGET_NOT_FOUND', { reason: 'unregistered' });
    return this.tenancy.runForMaintenance(tenantId, async () => {
      const keys = await resolve(id);
      if (!keys) throw new AppException('CDN_PURGE_TARGET_NOT_FOUND');
      const bucket = requireTenant().storageBucket;
      return { paths: [...new Set(keys)].map((key) => cdnPathOf(bucket, key)) };
    });
  }

  /** 依路徑清理：使用者給的是 bucket 裡的物件 key，加上那個租戶的 bucket（不能藉此清到別的租戶）。 */
  async pathsOf(tenantId: string, keys: readonly string[]): Promise<ResolvedCdnPaths> {
    return this.tenancy.runForMaintenance(tenantId, async () => {
      const bucket = requireTenant().storageBucket;
      return { paths: [...new Set(keys)].map((key) => cdnPathOf(bucket, key)) };
    });
  }
}
