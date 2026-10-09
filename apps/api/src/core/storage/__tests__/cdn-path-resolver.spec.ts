import { describe, expect, it, vi } from 'vitest';

import { AppException } from '../../errors';
import { runInTenantContext } from '../../tenant';
import type { Tenancy, TenantContext } from '../../tenant';
import { CdnPathResolver } from '../cdn-path-resolver';

/** 假的 Tenancy：以固定的 bucket 進入租戶（真的會檢查租戶存在與 migration 版本）。 */
function resolverOf() {
  const tenancy = {
    runForMaintenance: vi.fn(<T>(tenantId: string, fn: () => Promise<T>) =>
      runInTenantContext({ id: tenantId, storageBucket: `b2b-${tenantId}` } as TenantContext, fn),
    ),
  };
  return { resolver: new CdnPathResolver(tenancy as unknown as Tenancy), tenancy };
}

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    return error instanceof AppException ? error.code : String(error);
  }
  return undefined;
}

describe('CdnPathResolver（docs/architecture/backend/09-file.md §16.11）', () => {
  it('在那個租戶裡呼叫擁有者的解析函式，路徑加上那個租戶的 bucket、去重', async () => {
    const { resolver, tenancy } = resolverOf();
    resolver.register('imageAsset', async (id) => [
      `images/${id}/master.webp`,
      `images/${id}/master.webp`,
    ]);

    await expect(resolver.resolve('acme', 'imageAsset', 'a1')).resolves.toEqual({
      paths: ['/storage/b2b-acme/images/a1/master.webp'],
    });
    expect(tenancy.runForMaintenance).toHaveBeenCalledWith('acme', expect.any(Function));
    expect(resolver.registered()).toEqual(['imageAsset']);
  });

  it('擁有者回 null（找不到那筆資源）→ 404 CDN_PURGE_TARGET_NOT_FOUND', async () => {
    const { resolver } = resolverOf();
    resolver.register('fileVariant', async () => null);
    expect(await codeOf(resolver.resolve('acme', 'fileVariant', 'missing'))).toBe(
      'CDN_PURGE_TARGET_NOT_FOUND',
    );
  });

  it('沒有登記解析器的資源類型（例：圖片庫還沒做）→ 同樣 404，不進入租戶', async () => {
    const { resolver, tenancy } = resolverOf();
    expect(await codeOf(resolver.resolve('acme', 'galleryItem', 'g1'))).toBe(
      'CDN_PURGE_TARGET_NOT_FOUND',
    );
    expect(tenancy.runForMaintenance).not.toHaveBeenCalled();
  });

  it('同一種資源只能登記一次', () => {
    const { resolver } = resolverOf();
    resolver.register('imageAsset', async () => []);
    expect(() => resolver.register('imageAsset', async () => [])).toThrow('已經登記過');
  });

  it('依路徑清理：物件 key 加上那個租戶的 bucket', async () => {
    const { resolver } = resolverOf();
    await expect(
      resolver.pathsOf('acme', ['variants/f1/preview.webp', 'variants/f1/preview.webp']),
    ).resolves.toEqual({
      paths: ['/storage/b2b-acme/variants/f1/preview.webp'],
    });
  });
});
