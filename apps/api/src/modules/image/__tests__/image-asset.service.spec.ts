import type { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';

import type { AuthUser } from '@/common/types';
import type { Env } from '@/core/config';
import type { Database } from '@/core/database';
import { AppException } from '@/core/errors';
import type { ImageUrlService } from '@/core/image';
import type { JobQueue } from '@/core/jobs';
import type { ObjectStorage, ObjectUrlSigner } from '@/core/storage';
import { runInTenantContext } from '@/core/tenant';
import type { TenantContext } from '@/core/tenant';
import type { StorageCapacity } from '@/core/usage';
import type { ImageAssetRow } from '@/db/schema';

import type { ImageAssetRepository } from '../image-asset.repository';
import { ImageAssetService } from '../image-asset.service';
import { ImageOwnerRegistry } from '../image-owner.registry';
import { IMAGE_PROCESS_JOB } from '../image-process.job';
import { ImageSourceRegistry } from '../image-source.registry';
import type { ResolvedImage } from '../image-source.registry';
import { ImageUsageRegistry, RASTER_IMAGE_TYPES } from '../image-usage.registry';
import { IMAGE_PENDING_PER_USER, masterKeyOf, uploadKeyOf } from '../image.constants';

const MIB = 1024 * 1024;
const ACTOR = { id: '11111111-1111-4111-8111-111111111111' } as AuthUser;
const OTHER = '22222222-2222-4222-8222-222222222222';
const ASSET = '33333333-3333-4333-8333-333333333333';
const OWNER = { ownerType: 'user', ownerId: OTHER };

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
    queuedAt: null,
    staleRevsPurgeAfter: null,
    ownerType: null,
    ownerId: null,
    detachedAt: null,
    hiddenFromRecentAt: null,
    createdAt: new Date('2026-10-09T00:00:00Z'),
    createdBy: ACTOR.id,
    updatedAt: new Date('2026-10-09T00:00:00Z'),
    ...overrides,
  };
}

function inTenant<T>(fn: () => Promise<T>, features: string[] = ['file']): Promise<T> {
  return runInTenantContext(
    {
      id: 't1',
      features,
      featureParams: { 'file.storageQuotaMb': 100 },
    } as unknown as TenantContext,
    fn,
  );
}

async function expectCode(promise: Promise<unknown>, code: string, details?: object) {
  const error = await promise.catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(AppException);
  expect((error as AppException).code).toBe(code);
  if (details) expect((error as AppException).details).toMatchObject(details);
}

function setup(options: { row?: ImageAssetRow; pending?: number; used?: number } = {}) {
  let current = options.row ?? assetRow();
  const repo = {
    create: vi.fn(async (values: Partial<ImageAssetRow>) => {
      current = assetRow(values);
      return current;
    }),
    findById: vi.fn(async () => current),
    findByIds: vi.fn(async () => [current]),
    countPending: vi.fn(async () => options.pending ?? 0),
    storageUsed: vi.fn(async () => options.used ?? 0),
    markQueued: vi.fn(async () => undefined),
    setCrop: vi.fn(async () => undefined),
    recent: vi.fn(async (): Promise<ImageAssetRow[]> => []),
    hideFromRecent: vi.fn(async () => true),
    claim: vi.fn(async (): Promise<ImageAssetRow | undefined> => ({
      ...current,
      ownerType: OWNER.ownerType,
      ownerId: OWNER.ownerId,
    })),
    recrop: vi.fn(async (): Promise<ImageAssetRow | undefined> => current),
    detachOne: vi.fn(async () => undefined),
    detach: vi.fn(async () => undefined),
  };
  const usages = new ImageUsageRegistry();
  usages.register({
    id: 'user.avatar',
    maxSize: 10 * MIB,
    contentTypes: RASTER_IMAGE_TYPES,
    minWidth: 128,
    minHeight: 128,
    aspectRatio: 1,
    presets: { sm: 32 },
    urlTtl: 3600,
    visibility: 'signed',
  });
  const sources = new ImageSourceRegistry();
  const storage = {
    ensureBucket: vi.fn(async () => undefined),
    head: vi.fn(async (): Promise<unknown> => ({
      size: 1000,
      etag: 'e',
      contentType: 'image/png',
    })),
    delete: vi.fn(async () => undefined),
    copyObject: vi.fn(async () => true),
    presignUpload: vi.fn(async (key: string) => ({
      url: `https://storage.test/${key}`,
      method: 'PUT' as const,
      headers: { 'Content-Type': 'image/png' },
      expiresAt: new Date('2026-10-09T01:00:00Z'),
    })),
  };
  const signer = {
    sign: vi.fn(async (key: string) => ({ url: `https://s/${key}`, expiresAt: new Date() })),
  };
  const urls = {
    sources: vi.fn(async () => ({ width: 1, height: 1, expiresAt: '', variants: {} })),
  };
  const jobs = { enqueue: vi.fn(async () => undefined) };
  const capacity = { assertCanStore: vi.fn(async () => undefined) };
  const db = { transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn('tx')) };
  const service = new ImageAssetService(
    db as unknown as Database,
    repo as unknown as ImageAssetRepository,
    usages,
    sources,
    new ImageOwnerRegistry(),
    storage as unknown as ObjectStorage,
    signer as unknown as ObjectUrlSigner,
    urls as unknown as ImageUrlService,
    jobs as unknown as JobQueue,
    capacity as unknown as StorageCapacity,
    { get: () => 900 } as unknown as ConfigService<Env, true>,
  );
  return {
    service,
    repo,
    usages,
    sources,
    storage,
    jobs,
    capacity,
    setRow: (row: ImageAssetRow) => (current = row),
  };
}

const UPLOAD = { usage: 'user.avatar', name: 'me.png', contentType: 'image/png', size: 1000 };

describe('ImageAssetService.createUpload（docs/architecture/backend/25-image.md §15.4）', () => {
  it('只用來過濾的用途（filterOnly，docs/architecture/backend/26-gallery.md §8）不能建立圖片資產', async () => {
    const { service, repo, usages } = setup();
    usages.register({
      id: 'gallery.item',
      maxSize: 10 * MIB,
      contentTypes: RASTER_IMAGE_TYPES,
      minWidth: 1,
      minHeight: 1,
      presets: { thumb: 480 },
      urlTtl: 3600,
      visibility: 'signed',
      filterOnly: true,
    });
    await expectCode(
      inTenant(() => service.createUpload({ ...UPLOAD, usage: 'gallery.item' }, ACTOR)),
      'VALIDATION_FAILED',
    );
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('登記一筆 pending 並發直傳網址（大小與型別簽進網址）', async () => {
    const { service, repo, storage } = setup();
    const result = await inTenant(() => service.createUpload(UPLOAD, ACTOR));
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        usage: 'user.avatar',
        source: 'upload',
        size: 1000,
        createdBy: ACTOR.id,
      }),
      100 * MIB,
      'tx',
    );
    expect(storage.presignUpload).toHaveBeenCalledWith(uploadKeyOf(result.asset.id), {
      contentType: 'image/png',
      contentLength: 1000,
      expiresIn: 900,
    });
    expect(result.upload.method).toBe('PUT');
    expect(result.asset.status).toBe('pending');
  });

  it.each([
    ['不存在的用途', { usage: 'nope.nope' }, 'VALIDATION_FAILED'],
    ['用途不收的型別（SVG）', { contentType: 'image/svg+xml' }, 'IMAGE_TYPE_NOT_ALLOWED'],
    ['超過用途的大小上限', { size: 11 * MIB }, 'IMAGE_TOO_LARGE'],
  ])('%s → %s', async (_name, override, code) => {
    const { service, repo } = setup();
    await expectCode(
      inTenant(() => service.createUpload({ ...UPLOAD, ...override }, ACTOR)),
      code,
    );
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('處理中的圖片達上限 → IMAGE_PENDING_LIMIT_REACHED', async () => {
    const { service } = setup({ pending: IMAGE_PENDING_PER_USER });
    await expectCode(
      inTenant(() => service.createUpload(UPLOAD, ACTOR)),
      'IMAGE_PENDING_LIMIT_REACHED',
    );
  });

  it('超過租戶的容量（與檔案共用）→ FILE_STORAGE_QUOTA_EXCEEDED；先檢查止水線', async () => {
    const { service, capacity } = setup({ used: 100 * MIB });
    await expectCode(
      inTenant(() => service.createUpload(UPLOAD, ACTOR)),
      'FILE_STORAGE_QUOTA_EXCEEDED',
      { quota: 100 * MIB, used: 100 * MIB, size: 1000 },
    );
    expect(capacity.assertCanStore).toHaveBeenCalledWith(1000);
  });

  it('同時的登記先用掉了容量（條件式 UPDATE 沒命中）→ FILE_STORAGE_QUOTA_EXCEEDED', async () => {
    const { service, repo } = setup();
    repo.create.mockResolvedValueOnce(undefined as never);
    await expectCode(
      inTenant(() => service.createUpload(UPLOAD, ACTOR)),
      'FILE_STORAGE_QUOTA_EXCEEDED',
    );
  });
});

describe('ImageAssetService.completeUpload', () => {
  it('確認物件存在且大小相符 → 帶裁切、排入 image.process（交易內）', async () => {
    const { service, repo, jobs } = setup();
    const crop = { x: 0, y: 0, width: 0.5, height: 0.5 };
    await inTenant(() => service.completeUpload(ASSET, { crop }, ACTOR));
    expect(repo.markQueued).toHaveBeenCalledWith(ASSET, 'tx');
    expect(repo.setCrop).toHaveBeenCalledWith(ASSET, crop, 'tx');
    expect(jobs.enqueue).toHaveBeenCalledWith(IMAGE_PROCESS_JOB, { assetId: ASSET }, { tx: 'tx' });
  });

  it('別人的資產 → IMAGE_ASSET_NOT_FOUND', async () => {
    const { service } = setup({ row: assetRow({ createdBy: OTHER }) });
    await expectCode(
      inTenant(() => service.completeUpload(ASSET, {}, ACTOR)),
      'IMAGE_ASSET_NOT_FOUND',
    );
  });

  it('已經確認過 → IMAGE_ALREADY_UPLOADED', async () => {
    const { service } = setup({ row: assetRow({ queuedAt: new Date() }) });
    await expectCode(
      inTenant(() => service.completeUpload(ASSET, {}, ACTOR)),
      'IMAGE_ALREADY_UPLOADED',
    );
  });

  it('物件不存在 → IMAGE_UPLOAD_INCOMPLETE；大小不符或帶內容編碼 → 刪掉內容後 IMAGE_UPLOAD_INCOMPLETE', async () => {
    const { service, storage, jobs } = setup();
    storage.head.mockResolvedValueOnce(undefined);
    await expectCode(
      inTenant(() => service.completeUpload(ASSET, {}, ACTOR)),
      'IMAGE_UPLOAD_INCOMPLETE',
    );
    storage.head.mockResolvedValueOnce({ size: 999, etag: 'e', contentType: 'image/png' });
    await expectCode(
      inTenant(() => service.completeUpload(ASSET, {}, ACTOR)),
      'IMAGE_UPLOAD_INCOMPLETE',
    );
    storage.head.mockResolvedValueOnce({
      size: 1000,
      etag: 'e',
      contentType: 'image/png',
      contentEncoding: 'gzip',
    });
    await expectCode(
      inTenant(() => service.completeUpload(ASSET, {}, ACTOR)),
      'IMAGE_UPLOAD_INCOMPLETE',
    );
    expect(storage.delete).toHaveBeenCalledTimes(2);
    expect(jobs.enqueue).not.toHaveBeenCalled();
  });

  it('裁切超出圖片 → IMAGE_CROP_INVALID', async () => {
    const { service } = setup();
    await expectCode(
      inTenant(() =>
        service.completeUpload(ASSET, { crop: { x: 0.8, y: 0, width: 0.5, height: 1 } }, ACTOR),
      ),
      'IMAGE_CROP_INVALID',
    );
  });
});

describe('ImageAssetService.createFromSource（§15.2）', () => {
  const FROM_FILE = { usage: 'user.avatar', source: 'file', refId: 'f1' };
  const resolved: ResolvedImage = {
    storageKey: 'files/f1',
    contentType: 'image/jpeg',
    size: 2000,
    name: '團隊照.jpg',
    width: 800,
    height: 600,
  };

  function withFileSource(ctx: ReturnType<typeof setup>, image: ResolvedImage = resolved) {
    const resolve = vi.fn(async () => image);
    ctx.sources.register({ id: 'file', feature: 'file', resolve });
    return resolve;
  }

  it('來源以呼叫者的身分解析，帶上用途字串；物件以 CopyObject 複製到 upload，排入處理', async () => {
    const ctx = setup();
    const resolve = withFileSource(ctx);
    const result = await inTenant(() => ctx.service.createFromSource(FROM_FILE, ACTOR));
    expect(resolve).toHaveBeenCalledWith('f1', ACTOR, 'imageAsset:user.avatar');
    expect(ctx.storage.copyObject).toHaveBeenCalledWith('files/f1', uploadKeyOf(result.id));
    expect(ctx.repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'file',
        sourceRefId: 'f1',
        sourceName: '團隊照.jpg',
        size: 2000,
      }),
      100 * MIB,
      'tx',
    );
    expect(ctx.jobs.enqueue).toHaveBeenCalledWith(
      IMAGE_PROCESS_JOB,
      { assetId: result.id },
      { tx: 'tx' },
    );
  });

  it('已經是正規化過的主檔（最近使用）→ 直接複製成主檔，帶上尺寸與內容雜湊', async () => {
    const ctx = setup();
    withFileSource(ctx, {
      ...resolved,
      normalized: { width: 800, height: 600, hasAlpha: false, format: 'jpeg', contentHash: 'h1' },
    });
    const result = await inTenant(() => ctx.service.createFromSource(FROM_FILE, ACTOR));
    expect(ctx.storage.copyObject).toHaveBeenCalledWith('files/f1', masterKeyOf(result.id, 'jpeg'));
    expect(ctx.repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ masterFormat: 'jpeg', width: 800, contentHash: 'h1' }),
      100 * MIB,
      'tx',
    );
  });

  it('來源所屬的 feature 沒啟用 → FEATURE_DISABLED（不呼叫來源）', async () => {
    const ctx = setup();
    const resolve = withFileSource(ctx);
    await expectCode(
      inTenant(() => ctx.service.createFromSource(FROM_FILE, ACTOR), []),
      'FEATURE_DISABLED',
    );
    expect(resolve).not.toHaveBeenCalled();
  });

  it('沒有登記的來源 → IMAGE_SOURCE_NOT_FOUND', async () => {
    const ctx = setup();
    await expectCode(
      inTenant(() => ctx.service.createFromSource(FROM_FILE, ACTOR)),
      'IMAGE_SOURCE_NOT_FOUND',
    );
  });

  it('知道尺寸時先擋掉太小的圖（裁切之後不到 128 × 128）→ IMAGE_TOO_SMALL', async () => {
    const ctx = setup();
    withFileSource(ctx, { ...resolved, width: 300, height: 100 });
    await expectCode(
      inTenant(() => ctx.service.createFromSource(FROM_FILE, ACTOR)),
      'IMAGE_TOO_SMALL',
      { minWidth: 128, minHeight: 128 },
    );
    expect(ctx.storage.copyObject).not.toHaveBeenCalled();
  });

  it('物件已經不在 → IMAGE_ASSET_NOT_USABLE（sourceMissing）', async () => {
    const ctx = setup();
    withFileSource(ctx);
    ctx.storage.copyObject.mockResolvedValueOnce(false);
    await expectCode(
      inTenant(() => ctx.service.createFromSource(FROM_FILE, ACTOR)),
      'IMAGE_ASSET_NOT_USABLE',
      { reason: 'sourceMissing' },
    );
  });

  it('登記失敗（容量）→ 刪掉剛複製的物件', async () => {
    const ctx = setup();
    withFileSource(ctx);
    ctx.repo.create.mockResolvedValueOnce(undefined as never);
    await expectCode(
      inTenant(() => ctx.service.createFromSource(FROM_FILE, ACTOR)),
      'FILE_STORAGE_QUOTA_EXCEEDED',
    );
    const [target] = ctx.storage.copyObject.mock.calls[0]?.slice(1) ?? [];
    expect(ctx.storage.delete).toHaveBeenCalledWith(target);
  });
});

describe('ImageAssetService：consumer 的 API（§15.8）', () => {
  it('claim：自己建立、沒被使用、用途相同才認領得到；帶裁切時重新排入處理', async () => {
    const ctx = setup({ row: assetRow({ status: 'ready', width: 800, height: 600 }) });
    const crop = { x: 0, y: 0, width: 0.5, height: 0.5 };
    await inTenant(() =>
      ctx.service.claim(ASSET, OWNER, 'user.avatar', crop, ACTOR, 'tx' as never),
    );
    expect(ctx.repo.claim).toHaveBeenCalledWith(
      ASSET,
      { ...OWNER, actorId: ACTOR.id, usage: 'user.avatar' },
      crop,
      'tx',
    );
    expect(ctx.jobs.enqueue).toHaveBeenCalledWith(
      IMAGE_PROCESS_JOB,
      { assetId: ASSET },
      { tx: 'tx' },
    );
  });

  it('claim：別人的資產 → IMAGE_ASSET_NOT_FOUND；已被使用 → IMAGE_ASSET_NOT_USABLE（inUse）', async () => {
    const other = setup({ row: assetRow({ createdBy: OTHER }) });
    await expectCode(
      inTenant(() =>
        other.service.claim(ASSET, OWNER, 'user.avatar', undefined, ACTOR, 'tx' as never),
      ),
      'IMAGE_ASSET_NOT_FOUND',
    );
    const used = setup({ row: assetRow({ ownerType: 'user', ownerId: ACTOR.id }) });
    used.repo.claim.mockResolvedValueOnce(undefined);
    await expectCode(
      inTenant(() =>
        used.service.claim(ASSET, OWNER, 'user.avatar', undefined, ACTOR, 'tx' as never),
      ),
      'IMAGE_ASSET_NOT_USABLE',
      { reason: 'inUse' },
    );
  });

  it('claim：處理失敗的 → IMAGE_ASSET_NOT_USABLE（failed）', async () => {
    const ctx = setup({ row: assetRow({ status: 'failed' }) });
    ctx.repo.claim.mockResolvedValueOnce(undefined);
    await expectCode(
      inTenant(() =>
        ctx.service.claim(ASSET, OWNER, 'user.avatar', undefined, ACTOR, 'tx' as never),
      ),
      'IMAGE_ASSET_NOT_USABLE',
      { reason: 'failed' },
    );
  });

  it('recrop：只能是這個擁有者的資產；裁切之後太小 → IMAGE_TOO_SMALL', async () => {
    const ctx = setup({
      row: assetRow({
        status: 'ready',
        width: 400,
        height: 400,
        ownerType: 'user',
        ownerId: OTHER,
      }),
    });
    await expectCode(
      inTenant(() =>
        ctx.service.recrop(ASSET, OWNER, { x: 0, y: 0, width: 0.2, height: 0.2 }, 'tx' as never),
      ),
      'IMAGE_TOO_SMALL',
    );
    await inTenant(() =>
      ctx.service.recrop(ASSET, OWNER, { x: 0, y: 0, width: 0.5, height: 0.5 }, 'tx' as never),
    );
    expect(ctx.repo.recrop).toHaveBeenCalled();
    expect(ctx.jobs.enqueue).toHaveBeenCalledTimes(1);
    await expectCode(
      inTenant(() =>
        ctx.service.recrop(
          ASSET,
          { ownerType: 'user', ownerId: ACTOR.id },
          { x: 0, y: 0, width: 1, height: 1 },
          'tx' as never,
        ),
      ),
      'IMAGE_ASSET_NOT_FOUND',
    );
  });
});

describe('ImageAssetService.recent（§15.7）', () => {
  it('以用途過濾型別與大小；太小的照樣列出', async () => {
    const ctx = setup();
    ctx.repo.recent.mockResolvedValueOnce([
      assetRow({ id: 'a', status: 'ready', contentType: 'image/jpeg', width: 50, height: 50 }),
      assetRow({ id: 'b', status: 'ready', contentType: 'image/tiff' }),
      assetRow({ id: 'c', status: 'ready', contentType: 'image/webp', size: 11 * MIB }),
    ]);
    const { items } = await inTenant(() => ctx.service.recent('user.avatar', ACTOR));
    expect(items.map((item) => item.id)).toEqual(['a']);
  });

  it('從最近使用移除：不是自己的 → IMAGE_ASSET_NOT_FOUND', async () => {
    const ctx = setup();
    ctx.repo.hideFromRecent.mockResolvedValueOnce(false);
    await expectCode(
      inTenant(() => ctx.service.hideFromRecent(ASSET, ACTOR)),
      'IMAGE_ASSET_NOT_FOUND',
    );
  });
});
