import { Readable } from 'node:stream';

import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';

import type { Database } from '@/core/database';
import type { DomainEventBus } from '@/core/events';
import { SharpImageProcessor } from '@/core/image/sharp-image-processor';
import type { JobQueue } from '@/core/jobs';
import type { ObjectStorage } from '@/core/storage';
import type { ImageAssetRow, ImageAssetVariants } from '@/db/schema';

import type { ImageAssetRepository } from '../image-asset.repository';
import { ImageOwnerRegistry } from '../image-owner.registry';
import { ImageProcessService } from '../image-process.service';
import { ImageUsageRegistry, RASTER_IMAGE_TYPES } from '../image-usage.registry';
import { masterKeyOf, revPrefixOf, uploadKeyOf } from '../image.constants';

const ASSET = '33333333-3333-4333-8333-333333333333';
const CREATOR = '11111111-1111-4111-8111-111111111111';

function png(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: '#3366ff' } })
    .png()
    .toBuffer();
}

function assetRow(overrides: Partial<ImageAssetRow> = {}): ImageAssetRow {
  return {
    id: ASSET,
    usage: 'user.avatar',
    status: 'pending',
    failureReason: null,
    source: 'upload',
    sourceRefId: null,
    sourceName: 'me.png',
    contentType: 'image/png',
    size: 1000,
    width: null,
    height: null,
    hasAlpha: null,
    masterFormat: null,
    contentHash: null,
    crop: null,
    rev: 1,
    variantRev: null,
    variants: null,
    queuedAt: new Date(),
    staleRevsPurgeAfter: null,
    ownerType: null,
    ownerId: null,
    detachedAt: null,
    hiddenFromRecentAt: null,
    createdAt: new Date(),
    createdBy: CREATOR,
    updatedAt: new Date(),
    ...overrides,
  };
}

function setup(initial: ImageAssetRow, objects: Record<string, Buffer> = {}) {
  let row = initial;
  const store = new Map(Object.entries(objects));
  const storage = {
    getObject: vi.fn(async (key: string) => {
      const data = store.get(key);
      return data ? Readable.from([data]) : undefined;
    }),
    putObject: vi.fn(async (key: string, body: Buffer) => {
      store.set(key, body);
    }),
    delete: vi.fn(async (key: string) => {
      store.delete(key);
    }),
  };
  const repo = {
    findById: vi.fn(async () => row),
    setMaster: vi.fn(async (_id: string, values: Partial<ImageAssetRow>) => {
      row = { ...row, ...values };
      return true;
    }),
    setVariants: vi.fn(async (_id: string, rev: number, variants: ImageAssetVariants) => {
      if (rev !== row.rev) return undefined;
      row = { ...row, status: 'ready', variantRev: rev, variants };
      return row;
    }),
    scheduleStaleRevsPurge: vi.fn(async () => undefined),
    markFailed: vi.fn(async (_id: string, reason: string) => {
      row = { ...row, status: 'failed', failureReason: reason };
      return row;
    }),
  };
  const usages = new ImageUsageRegistry();
  usages.register({
    id: 'user.avatar',
    maxSize: 1024 * 1024,
    contentTypes: RASTER_IMAGE_TYPES,
    minWidth: 128,
    minHeight: 128,
    aspectRatio: 1,
    presets: { sm: 32, md: 96, lg: 256 },
    urlTtl: 3600,
    visibility: 'signed',
  });
  const owners = new ImageOwnerRegistry();
  const onImageReady = vi.fn();
  owners.register({ ownerType: 'user', onImageReady });
  const events = { publish: vi.fn() };
  const db = { transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn('tx')) };
  const service = new ImageProcessService(
    db as unknown as Database,
    repo as unknown as ImageAssetRepository,
    usages,
    owners,
    storage as unknown as ObjectStorage,
    new SharpImageProcessor(),
    events as unknown as DomainEventBus,
    { register: vi.fn() } as unknown as JobQueue,
  );
  return { service, repo, store, events, onImageReady, row: () => row };
}

describe('ImageProcessService（image.process，docs/architecture/backend/25-image.md §15.5）', () => {
  it('寫主檔（不裁切）→ 刪原檔 → 產生每個 preset 的 1x、2x × JPEG 與 WebP → ready，推給建立者', async () => {
    const ctx = setup(assetRow(), { [uploadKeyOf(ASSET)]: await png(400, 300) });
    await ctx.service.process(ASSET);

    expect(ctx.repo.setMaster).toHaveBeenCalledWith(
      ASSET,
      expect.objectContaining({
        width: 400,
        height: 300,
        masterFormat: 'jpeg',
        contentType: 'image/jpeg',
      }),
      'tx',
    );
    expect(ctx.store.has(uploadKeyOf(ASSET))).toBe(false);
    expect(ctx.store.has(masterKeyOf(ASSET, 'jpeg'))).toBe(true);

    const { variants } = ctx.row();
    // 沒給裁切但用途要 1:1：取中央 300 × 300
    expect(variants).toMatchObject({ width: 300, height: 300, formats: ['jpeg', 'webp'] });
    expect(variants?.renditions.sm).toEqual({ width: 32, height: 32 });
    expect(variants?.renditions['sm@2x']).toEqual({ width: 64, height: 64 });
    // lg@2x（512）超過裁切後的 300：不放大，與 lg（256）不同、與原尺寸 300 相同
    expect(variants?.renditions['lg@2x']).toEqual({ width: 300, height: 300 });
    const prefix = revPrefixOf(ASSET, 1);
    expect(ctx.store.has(`${prefix}/sm.jpg`)).toBe(true);
    expect(ctx.store.has(`${prefix}/sm.webp`)).toBe(true);

    expect(ctx.events.publish).toHaveBeenCalledWith('resource.changed', {
      changes: [],
      perRecipient: [
        { userId: CREATOR, changes: [{ resource: 'image', kind: 'update', id: ASSET }] },
      ],
    });
  });

  it('2x 與另一個尺寸一樣大時共用物件（sameAs），不重複寫', async () => {
    // 裁切後 150：md@2x（192）與 lg（256）、lg@2x 都會停在 150
    const ctx = setup(assetRow(), { [uploadKeyOf(ASSET)]: await png(150, 150) });
    await ctx.service.process(ASSET);
    const renditions = ctx.row().variants?.renditions ?? {};
    expect(renditions['md@2x']).toEqual({ width: 150, height: 150 });
    expect(renditions.lg).toEqual({ width: 150, height: 150, sameAs: 'md@2x' });
    expect(renditions['lg@2x']).toEqual({ width: 150, height: 150, sameAs: 'md@2x' });
    expect(ctx.store.has(`${revPrefixOf(ASSET, 1)}/lg.jpg`)).toBe(false);
  });

  it('已被某個資源使用：處理好之後通知擁有者推它自己的變更', async () => {
    const ctx = setup(assetRow({ ownerType: 'user', ownerId: 'u-9' }), {
      [uploadKeyOf(ASSET)]: await png(200, 200),
    });
    await ctx.service.process(ASSET);
    expect(ctx.onImageReady).toHaveBeenCalledWith('u-9');
  });

  it.each([
    [
      'SVG（不交給解碼器）',
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
      'typeNotAllowed',
    ],
    ['不是圖片', Buffer.from('hello world, definitely not an image'), 'notImage'],
  ])('%s → failed（%s），推給建立者', async (_name, data, reason) => {
    const ctx = setup(assetRow(), { [uploadKeyOf(ASSET)]: data });
    await ctx.service.process(ASSET);
    expect(ctx.repo.markFailed).toHaveBeenCalledWith(ASSET, reason);
    expect(ctx.repo.setMaster).not.toHaveBeenCalled();
    expect(ctx.events.publish).toHaveBeenCalled();
  });

  it('太小（裁切之後不到 128）→ failed（tooSmall）', async () => {
    const ctx = setup(assetRow(), { [uploadKeyOf(ASSET)]: await png(300, 100) });
    await ctx.service.process(ASSET);
    expect(ctx.repo.markFailed).toHaveBeenCalledWith(ASSET, 'tooSmall');
  });

  it('原檔不存在 → failed（missing）；超過用途的大小上限 → failed（tooLarge）並刪掉原檔', async () => {
    const missing = setup(assetRow());
    await missing.service.process(ASSET);
    expect(missing.repo.markFailed).toHaveBeenCalledWith(ASSET, 'missing');

    const huge = setup(assetRow(), { [uploadKeyOf(ASSET)]: Buffer.alloc(1024 * 1024 + 1) });
    await huge.service.process(ASSET);
    expect(huge.repo.markFailed).toHaveBeenCalledWith(ASSET, 'tooLarge');
    expect(huge.store.has(uploadKeyOf(ASSET))).toBe(false);
  });

  it('重新裁切：以主檔產生新的版本（r2）；處理途中又被重新裁切 → 不寫回，交給清理', async () => {
    const master = await sharp(await png(400, 400))
      .jpeg()
      .toBuffer();
    const base = assetRow({
      status: 'ready',
      width: 400,
      height: 400,
      hasAlpha: false,
      masterFormat: 'jpeg',
      contentType: 'image/jpeg',
      rev: 2,
      variantRev: 1,
      crop: { x: 0, y: 0, width: 0.5, height: 0.5 },
    });
    const ctx = setup(base, { [masterKeyOf(ASSET, 'jpeg')]: master });
    await ctx.service.process(ASSET);
    expect(ctx.row().variantRev).toBe(2);
    expect(ctx.row().variants).toMatchObject({ width: 200, height: 200 });
    expect(ctx.store.has(`${revPrefixOf(ASSET, 2)}/sm.jpg`)).toBe(true);

    const raced = setup(base, { [masterKeyOf(ASSET, 'jpeg')]: master });
    raced.repo.setVariants.mockResolvedValueOnce(undefined);
    await raced.service.process(ASSET);
    expect(raced.repo.scheduleStaleRevsPurge).toHaveBeenCalledWith(ASSET, expect.any(Date));
  });

  it('要求的版本已經寫好、或已經失敗 → 什麼都不做', async () => {
    const done = setup(
      assetRow({ status: 'ready', masterFormat: 'jpeg', width: 400, height: 400, variantRev: 1 }),
    );
    await done.service.process(ASSET);
    const failed = setup(assetRow({ status: 'failed' }));
    await failed.service.process(ASSET);
    expect(done.repo.setVariants).not.toHaveBeenCalled();
    expect(failed.repo.setMaster).not.toHaveBeenCalled();
  });
});
