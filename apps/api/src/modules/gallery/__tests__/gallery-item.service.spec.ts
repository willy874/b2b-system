import type { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';

import type { AuthUser } from '@/common/types';
import type { Env } from '@/core/config';
import type { Database } from '@/core/database';
import { AppException } from '@/core/errors';
import type { DomainEventBus } from '@/core/events';
import type { JobQueue } from '@/core/jobs';
import type { SettingService } from '@/core/settings';
import type { ObjectStorage } from '@/core/storage';
import { runInTenantContext } from '@/core/tenant';
import type { TenantContext } from '@/core/tenant';
import type { StorageCapacity } from '@/core/usage';
import type { GalleryItemRow } from '@/db/schema';
import type { AuditService } from '@/modules/audit-log/audit.service';
import type { ImageAssetService } from '@/modules/image/image-asset.service';
import { ImageSourceRegistry } from '@/modules/image/image-source.registry';
import type { ResolvedImage } from '@/modules/image/image-source.registry';
import type { TagService } from '@/modules/tag/tag.service';

import type { GalleryAlbumRepository } from '../gallery-album.repository';
import type { GalleryImageUrls } from '../gallery-image-urls';
import type { GalleryItemRepository } from '../gallery-item.repository';
import { GalleryItemService, titleFromFileName } from '../gallery-item.service';
import { GALLERY_PROCESS_JOB } from '../gallery-process.job';
import { GALLERY_PENDING_PER_USER, uploadKeyOf } from '../gallery.constants';

const MIB = 1024 * 1024;
const ACTOR = { id: '11111111-1111-4111-8111-111111111111', email: 'a@example.com' } as AuthUser;
const ITEM = '33333333-3333-4333-8333-333333333333';
const ALBUM = '44444444-4444-4444-8444-444444444444';

function itemRow(overrides: Partial<GalleryItemRow> = {}): GalleryItemRow {
  return {
    id: ITEM,
    title: 'photo',
    description: null,
    status: 'ready',
    failureReason: null,
    contentType: 'image/jpeg',
    size: 1000,
    width: 800,
    height: 600,
    displayRotation: 0,
    hasOriginal: true,
    rev: 1,
    variantRev: 1,
    variants: { width: 800, height: 600, formats: ['jpeg', 'webp'], renditions: {} },
    variantFormat: 'jpeg',
    dominantColor: '#336699',
    placeholder: 'LKO2?U%2Tw=w]~RBVZRi};RPxuwH',
    takenAt: null,
    sortAt: new Date('2026-10-09T00:00:00Z'),
    exif: null,
    locationStripped: false,
    contentHash: 'h',
    source: 'upload',
    sourceRefId: null,
    sourceName: 'photo.jpg',
    version: 3,
    queuedAt: null,
    staleRevsPurgeAfter: null,
    createdAt: new Date('2026-10-09T00:00:00Z'),
    createdBy: ACTOR.id,
    updatedAt: new Date('2026-10-09T00:00:00Z'),
    updatedBy: ACTOR.id,
    deletedAt: null,
    ...overrides,
  };
}

function inTenant<T>(fn: () => Promise<T>, features: string[] = ['gallery', 'file']): Promise<T> {
  return runInTenantContext(
    {
      id: 't1',
      features,
      featureParams: { 'file.storageQuotaMb': 100, 'gallery.maxItemSizeMb': 10 },
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

function setup(options: { row?: GalleryItemRow; pending?: number; album?: boolean } = {}) {
  let current: GalleryItemRow | undefined = options.row ?? itemRow();
  const repo = {
    create: vi.fn(async (values: Partial<GalleryItemRow>) => itemRow(values)),
    findById: vi.fn(async () => current),
    findVisible: vi.fn(async () =>
      current?.status === 'ready' && !current.deletedAt ? current : undefined,
    ),
    findDeletedById: vi.fn(async () => (current?.deletedAt ? current : undefined)),
    countPending: vi.fn(async () => options.pending ?? 0),
    storageUsed: vi.fn(async () => 0),
    markProcessing: vi.fn(async () => true),
    findBySource: vi.fn(async () => new Map<string, string>()),
    update: vi.fn(async () => current),
    findVersion: vi.fn(async () => current?.version),
    softDelete: vi.fn(async () => current),
    restore: vi.fn(async () => current),
    albumsOf: vi.fn(async () => [] as Array<{ id: string; name: string }>),
    duplicatesOf: vi.fn(async () => []),
    uploaderOf: vi.fn(async () => null),
  };
  const albums = {
    findActive: vi.fn(async () => (options.album === false ? undefined : { id: ALBUM })),
    addItems: vi.fn(async () => []),
  };
  const urls = {
    sourcesOf: vi.fn(async () => ({ width: 800, height: 600, expiresAt: '', variants: {} })),
    originalOf: vi.fn(async () => null),
    downloadsOf: vi.fn(async () => ({ original: 'o', large: 'l' })),
  };
  const tags = { tagsOf: vi.fn(async () => new Map()) };
  const audit = { record: vi.fn(async () => undefined) };
  const events = { publish: vi.fn() };
  const jobs = { enqueue: vi.fn(async () => undefined) };
  const storage = {
    ensureBucket: vi.fn(async () => undefined),
    head: vi.fn(async (): Promise<unknown> => ({ size: 1000, etag: 'e' })),
    delete: vi.fn(async () => undefined),
    copyObject: vi.fn(async () => true),
    presignUpload: vi.fn(async (key: string) => ({
      url: `https://storage.test/${key}`,
      method: 'PUT' as const,
      headers: {},
      expiresAt: new Date('2026-10-09T01:00:00Z'),
    })),
  };
  const capacity = { assertCanStore: vi.fn(async () => undefined) };
  const sources = new ImageSourceRegistry();
  const images = { findUsage: vi.fn(() => undefined) };
  const settings = { get: vi.fn(async () => 'Asia/Taipei') };
  const db = { transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn('tx')) };
  const service = new GalleryItemService(
    db as unknown as Database,
    repo as unknown as GalleryItemRepository,
    albums as unknown as GalleryAlbumRepository,
    urls as unknown as GalleryImageUrls,
    tags as unknown as TagService,
    audit as unknown as AuditService,
    events as unknown as DomainEventBus,
    jobs as unknown as JobQueue,
    storage as unknown as ObjectStorage,
    capacity as unknown as StorageCapacity,
    sources,
    images as unknown as ImageAssetService,
    settings as unknown as SettingService,
    { get: () => 900 } as unknown as ConfigService<Env, true>,
  );
  return {
    service,
    repo,
    albums,
    storage,
    jobs,
    audit,
    events,
    sources,
    setRow: (row: GalleryItemRow | undefined) => (current = row),
  };
}

const UPLOAD = { fileName: 'IMG_0001.JPG', contentType: 'image/jpeg', size: 1000 };

describe('titleFromFileName', () => {
  it.each([
    ['IMG_0001.JPG', 'IMG_0001'],
    ['產品/春季.v2.png', '春季.v2'],
    ['.hidden', '.hidden'],
    ['\u0001', 'image'],
  ])('%s → %s', (input, expected) => {
    expect(titleFromFileName(input)).toBe(expected);
  });
});

describe('GalleryItemService.createUpload（docs/architecture/backend/26-gallery.md §4）', () => {
  it('登記一筆 pending（標題預設是去掉副檔名的檔名），佔用容量，發直傳網址；帶相簿時一併加入', async () => {
    const { service, repo, albums, storage } = setup();
    const result = await inTenant(() => service.createUpload({ ...UPLOAD, albumId: ALBUM }, ACTOR));
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'IMG_0001', source: 'upload', size: 1000 }),
      100 * MIB,
      'tx',
    );
    expect(albums.addItems).toHaveBeenCalledWith(ALBUM, [result.item.id], ACTOR.id, 'tx');
    expect(storage.presignUpload).toHaveBeenCalledWith(uploadKeyOf(result.item.id), {
      contentType: 'image/jpeg',
      contentLength: 1000,
      expiresIn: 900,
    });
  });

  it.each([
    ['HEIC（D6）', { contentType: 'image/heic' }, 'GALLERY_TYPE_NOT_ALLOWED'],
    ['SVG', { contentType: 'image/svg+xml' }, 'GALLERY_TYPE_NOT_ALLOWED'],
    ['超過 feature 參數的上限', { size: 11 * MIB }, 'GALLERY_ITEM_TOO_LARGE'],
  ])('%s → %s', async (_name, override, code) => {
    const { service, repo } = setup();
    await expectCode(
      inTenant(() => service.createUpload({ ...UPLOAD, ...override }, ACTOR)),
      code,
    );
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('相簿不存在 → GALLERY_ALBUM_NOT_FOUND', async () => {
    const { service } = setup({ album: false });
    await expectCode(
      inTenant(() => service.createUpload({ ...UPLOAD, albumId: ALBUM }, ACTOR)),
      'GALLERY_ALBUM_NOT_FOUND',
    );
  });

  it('登記了還沒上傳完的太多 → GALLERY_PENDING_LIMIT_REACHED', async () => {
    const { service } = setup({ pending: GALLERY_PENDING_PER_USER });
    await expectCode(
      inTenant(() => service.createUpload(UPLOAD, ACTOR)),
      'GALLERY_PENDING_LIMIT_REACHED',
    );
  });

  it('容量不夠（同時的登記先用掉了）→ FILE_STORAGE_QUOTA_EXCEEDED', async () => {
    const { service, repo } = setup();
    repo.create.mockResolvedValueOnce(undefined as never);
    await expectCode(
      inTenant(() => service.createUpload(UPLOAD, ACTOR)),
      'FILE_STORAGE_QUOTA_EXCEEDED',
    );
  });
});

describe('GalleryItemService.completeUpload', () => {
  it('確認物件存在且大小相符 → processing，交易內排入 gallery.process', async () => {
    const { service, repo, jobs } = setup({ row: itemRow({ status: 'pending' }) });
    await inTenant(() => service.completeUpload(ITEM, ACTOR));
    expect(repo.markProcessing).toHaveBeenCalledWith(ITEM, 'tx');
    expect(jobs.enqueue).toHaveBeenCalledWith(GALLERY_PROCESS_JOB, { itemId: ITEM }, { tx: 'tx' });
  });

  it('別人的上傳當作不存在', async () => {
    const { service } = setup({ row: itemRow({ status: 'pending', createdBy: 'someone-else' }) });
    await expectCode(
      inTenant(() => service.completeUpload(ITEM, ACTOR)),
      'GALLERY_ITEM_NOT_FOUND',
    );
  });

  it('已經完成過 → GALLERY_ALREADY_UPLOADED', async () => {
    const { service } = setup({ row: itemRow({ status: 'processing' }) });
    await expectCode(
      inTenant(() => service.completeUpload(ITEM, ACTOR)),
      'GALLERY_ALREADY_UPLOADED',
    );
  });

  it('物件不存在、或大小不符（刪掉讓它重傳）→ GALLERY_UPLOAD_INCOMPLETE', async () => {
    const { service, storage } = setup({ row: itemRow({ status: 'pending' }) });
    storage.head.mockResolvedValueOnce(undefined);
    await expectCode(
      inTenant(() => service.completeUpload(ITEM, ACTOR)),
      'GALLERY_UPLOAD_INCOMPLETE',
    );
    storage.head.mockResolvedValueOnce({ size: 999, etag: 'e' });
    await expectCode(
      inTenant(() => service.completeUpload(ITEM, ACTOR)),
      'GALLERY_UPLOAD_INCOMPLETE',
    );
    expect(storage.delete).toHaveBeenCalledWith(uploadKeyOf(ITEM));
  });
});

describe('GalleryItemService.createFromSource（§8：複製，不引用）', () => {
  function register(sources: ImageSourceRegistry, images: Record<string, ResolvedImage | Error>) {
    sources.register({
      id: 'file',
      feature: 'file',
      resolve: async (refId) => {
        const image = images[refId];
        if (!image) throw new AppException('FILE_NOT_FOUND');
        if (image instanceof Error) throw image;
        return image;
      },
    });
  }
  const png = (name: string, size = 1000): ResolvedImage => ({
    storageKey: `files/${name}`,
    contentType: 'image/png',
    size,
    name,
  });

  it('逐筆回報：加入、型別不收、太大、看不到、已經加入過；加入的在物件儲存內複製並排入處理', async () => {
    const { service, sources, repo, storage, jobs } = setup();
    register(sources, {
      a: png('a.png'),
      pdf: { ...png('b.pdf'), contentType: 'application/pdf' },
      big: png('big.png', 11 * MIB),
    });
    repo.findBySource.mockResolvedValueOnce(new Map([['dup', ITEM]]));
    const { results } = await inTenant(() =>
      service.createFromSource(
        { source: 'file', refIds: ['a', 'pdf', 'big', 'gone', 'dup', 'a'] },
        ACTOR,
      ),
    );
    expect(results.map((result) => [result.refId, result.status, result.reason])).toEqual([
      ['a', 'added', null],
      ['pdf', 'skipped', 'typeNotAllowed'],
      ['big', 'skipped', 'tooLarge'],
      ['gone', 'skipped', 'notFound'],
      ['dup', 'skipped', 'alreadyAdded'],
    ]);
    expect(results[4]?.existingItemId).toBe(ITEM);
    const added = results[0]?.itemId ?? '';
    expect(storage.copyObject).toHaveBeenCalledWith('files/a.png', uploadKeyOf(added));
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'processing',
        source: 'file',
        sourceRefId: 'a',
        title: 'a',
      }),
      100 * MIB,
      'tx',
    );
    expect(jobs.enqueue).toHaveBeenCalledTimes(1);
  });

  it('來源的 feature 沒啟用 → 整批 FEATURE_DISABLED', async () => {
    const { service, sources } = setup();
    register(sources, { a: png('a.png') });
    await expectCode(
      inTenant(
        () => service.createFromSource({ source: 'file', refIds: ['a'] }, ACTOR),
        ['gallery'],
      ),
      'FEATURE_DISABLED',
    );
  });

  it('圖片庫自己、上傳不是「其他來源」→ IMAGE_SOURCE_NOT_FOUND', async () => {
    const { service } = setup();
    await expectCode(
      inTenant(() => service.createFromSource({ source: 'gallery', refIds: ['a'] }, ACTOR)),
      'IMAGE_SOURCE_NOT_FOUND',
    );
  });

  it('來源的其他錯誤（儲存服務不可用）不吞，整批失敗', async () => {
    const { service, sources } = setup();
    register(sources, { a: new AppException('FILE_STORAGE_UNAVAILABLE') });
    await expectCode(
      inTenant(() => service.createFromSource({ source: 'file', refIds: ['a'] }, ACTOR)),
      'FILE_STORAGE_UNAVAILABLE',
    );
  });

  it('登記失敗（容量）時刪掉剛複製的物件', async () => {
    const { service, sources, repo, storage } = setup();
    register(sources, { a: png('a.png') });
    repo.create.mockResolvedValueOnce(undefined as never);
    await expectCode(
      inTenant(() => service.createFromSource({ source: 'file', refIds: ['a'] }, ACTOR)),
      'FILE_STORAGE_QUOTA_EXCEEDED',
    );
    expect(storage.delete).toHaveBeenCalledTimes(1);
  });
});

describe('GalleryItemService.update / remove / restore', () => {
  it('版本不符 → GALLERY_ITEM_VERSION_CONFLICT（details.current）', async () => {
    const { service } = setup();
    await expectCode(
      inTenant(() => service.update(ITEM, { version: 1, title: 'x' }, ACTOR)),
      'GALLERY_ITEM_VERSION_CONFLICT',
      { current: 3 },
    );
  });

  it('改顯示方向：遞增要求的版本並排入處理；只記有變的欄位', async () => {
    const { service, repo, jobs, audit } = setup();
    await inTenant(() =>
      service.update(ITEM, { version: 3, displayRotation: 90, title: 'photo' }, ACTOR),
    );
    expect(repo.update).toHaveBeenCalledWith(
      ITEM,
      { displayRotation: 90, title: 'photo' },
      true,
      3,
      ACTOR.id,
      'tx',
    );
    expect(jobs.enqueue).toHaveBeenCalledWith(GALLERY_PROCESS_JOB, { itemId: ITEM }, { tx: 'tx' });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'galleryItem.update',
        changes: { before: { displayRotation: 0 }, after: { displayRotation: 90 } },
      }),
      'tx',
    );
  });

  it('條件式 UPDATE 沒命中（同時被改）→ 重讀版本後 409', async () => {
    const { service, repo } = setup();
    repo.update.mockResolvedValueOnce(undefined);
    repo.findVersion.mockResolvedValueOnce(4);
    await expectCode(
      inTenant(() => service.update(ITEM, { version: 3, title: 'y' }, ACTOR)),
      'GALLERY_ITEM_VERSION_CONFLICT',
      { current: 4 },
    );
  });

  it('還在處理的圖不能編輯、不能刪 → GALLERY_ITEM_NOT_FOUND', async () => {
    const { service, repo } = setup({ row: itemRow({ status: 'processing' }) });
    await expectCode(
      inTenant(() => service.update(ITEM, { version: 3, title: 'x' }, ACTOR)),
      'GALLERY_ITEM_NOT_FOUND',
    );
    repo.softDelete.mockResolvedValueOnce(undefined);
    await expectCode(
      inTenant(() => service.remove(ITEM, ACTOR)),
      'GALLERY_ITEM_NOT_FOUND',
    );
  });

  it('刪除：寫稽核並推 delete（refs 帶所在的相簿）', async () => {
    const { service, repo, events } = setup();
    repo.albumsOf.mockResolvedValueOnce([{ id: ALBUM, name: 'a' }]);
    await inTenant(() => service.remove(ITEM, ACTOR));
    expect(events.publish).toHaveBeenCalledWith('resource.changed', {
      changes: [
        { resource: 'galleryItem', kind: 'delete', id: ITEM, refs: { galleryAlbum: [ALBUM] } },
      ],
    });
  });

  it('還原：沒有被刪除 → GALLERY_ITEM_NOT_DELETED；不存在 → GALLERY_ITEM_NOT_FOUND', async () => {
    const { service, setRow } = setup();
    await expectCode(
      inTenant(() => service.restore(ITEM, ACTOR)),
      'GALLERY_ITEM_NOT_DELETED',
    );
    setRow(undefined);
    await expectCode(
      inTenant(() => service.restore(ITEM, ACTOR)),
      'GALLERY_ITEM_NOT_FOUND',
    );
  });
});
