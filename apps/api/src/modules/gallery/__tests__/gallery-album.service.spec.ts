import { describe, expect, it, vi } from 'vitest';

import type { AuthUser } from '@/common/types';
import type { Database } from '@/core/database';
import { AppException } from '@/core/errors';
import type { DomainEventBus } from '@/core/events';
import type { GalleryAlbumRow } from '@/db/schema';
import type { AuditService } from '@/modules/audit-log/audit.service';

import type { GalleryAlbumRepository } from '../gallery-album.repository';
import { GalleryAlbumService } from '../gallery-album.service';
import type { GalleryImageUrls } from '../gallery-image-urls';

const ACTOR = { id: '11111111-1111-4111-8111-111111111111' } as AuthUser;
const ALBUM = '44444444-4444-4444-8444-444444444444';
const OTHER = '55555555-5555-4555-8555-555555555555';
const ITEM = '33333333-3333-4333-8333-333333333333';

function albumRow(overrides: Partial<GalleryAlbumRow> = {}): GalleryAlbumRow {
  return {
    id: ALBUM,
    name: '品牌素材',
    description: null,
    coverItemId: null,
    version: 2,
    createdAt: new Date('2026-10-09T00:00:00Z'),
    createdBy: ACTOR.id,
    updatedAt: new Date('2026-10-09T00:00:00Z'),
    updatedBy: ACTOR.id,
    deletedAt: null,
    ...overrides,
  };
}

async function expectCode(promise: Promise<unknown>, code: string, details?: object) {
  const error = await promise.catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(AppException);
  expect((error as AppException).code).toBe(code);
  if (details) expect((error as AppException).details).toMatchObject(details);
}

function setup(
  options: { album?: GalleryAlbumRow; deleted?: GalleryAlbumRow; conflict?: string } = {},
) {
  const album = options.album ?? albumRow();
  const repo = {
    listWithCovers: vi.fn(async () => [{ ...album, itemCount: 0, cover: null }]),
    findActive: vi.fn(async () => (options.deleted ? undefined : album)),
    findDeletedById: vi.fn(async () => options.deleted),
    findNameConflict: vi.fn(async () => options.conflict),
    create: vi.fn(async () => album),
    update: vi.fn(async (): Promise<GalleryAlbumRow | undefined> => album),
    findVersion: vi.fn(async () => album.version),
    contains: vi.fn(async () => false),
    lockActive: vi.fn(async (): Promise<GalleryAlbumRow | undefined> => album),
    addItems: vi.fn(async () => [ITEM]),
    removeItems: vi.fn(async () => [] as string[]),
    softDelete: vi.fn(async () => album),
    restore: vi.fn(async () => album),
  };
  const audit = { record: vi.fn(async () => undefined) };
  const events = { publish: vi.fn() };
  const db = { transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn('tx')) };
  const service = new GalleryAlbumService(
    db as unknown as Database,
    repo as unknown as GalleryAlbumRepository,
    { sourcesOf: vi.fn(async () => null) } as unknown as GalleryImageUrls,
    audit as unknown as AuditService,
    events as unknown as DomainEventBus,
  );
  return { service, repo, audit, events };
}

describe('GalleryAlbumService（docs/architecture/backend/26-gallery.md §7）', () => {
  it('建立：名稱（不分大小寫）已被用掉 → GALLERY_ALBUM_NAME_DUPLICATE（details.conflictingAlbumId）', async () => {
    const { service, repo } = setup({ conflict: OTHER });
    await expectCode(service.create({ name: '品牌素材' }, ACTOR), 'GALLERY_ALBUM_NAME_DUPLICATE', {
      conflictingAlbumId: OTHER,
    });
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('建立：同時建立同名的被唯一索引擋下時，也回 GALLERY_ALBUM_NAME_DUPLICATE', async () => {
    const { service, repo } = setup();
    repo.create.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: '23505' }));
    await expectCode(service.create({ name: '品牌素材' }, ACTOR), 'GALLERY_ALBUM_NAME_DUPLICATE');
  });

  it('修改：版本不符 409；封面不是相簿裡的圖 → GALLERY_ALBUM_COVER_INVALID', async () => {
    const { service } = setup();
    await expectCode(
      service.update(ALBUM, { version: 1, name: 'x' }, ACTOR),
      'GALLERY_ALBUM_VERSION_CONFLICT',
      { current: 2 },
    );
    await expectCode(
      service.update(ALBUM, { version: 2, coverItemId: ITEM }, ACTOR),
      'GALLERY_ALBUM_COVER_INVALID',
    );
  });

  it('修改：不存在 → GALLERY_ALBUM_NOT_FOUND', async () => {
    const { service } = setup({ deleted: albumRow({ deletedAt: new Date() }) });
    await expectCode(
      service.update(ALBUM, { version: 2, name: 'x' }, ACTOR),
      'GALLERY_ALBUM_NOT_FOUND',
    );
  });

  it('加入圖片：一次批次一筆 galleryAlbum.update，推相簿與圖片的 update；沒有變化時不寫稽核', async () => {
    const { service, audit, events, repo } = setup();
    expect(await service.addItems(ALBUM, { itemIds: [ITEM] }, ACTOR)).toEqual({ changed: 1 });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'galleryAlbum.update',
        changes: { after: { addedItems: [ITEM] } },
      }),
      'tx',
    );
    expect(events.publish).toHaveBeenCalledWith('resource.changed', {
      changes: [
        { resource: 'galleryAlbum', kind: 'update', id: ALBUM },
        { resource: 'galleryItem', kind: 'update', id: ITEM },
      ],
    });
    audit.record.mockClear();
    expect(await service.removeItems(ALBUM, { itemIds: [ITEM] }, ACTOR)).toEqual({ changed: 0 });
    expect(audit.record).not.toHaveBeenCalled();
    repo.lockActive.mockResolvedValueOnce(undefined);
    await expectCode(
      service.addItems(ALBUM, { itemIds: [ITEM] }, ACTOR),
      'GALLERY_ALBUM_NOT_FOUND',
    );
  });

  it('還原：名稱被新的相簿用掉 → GALLERY_ALBUM_NAME_DUPLICATE；沒有被刪除 → GALLERY_ALBUM_NOT_DELETED', async () => {
    const deleted = albumRow({ deletedAt: new Date() });
    await expectCode(
      setup({ deleted, conflict: OTHER }).service.restore(ALBUM, ACTOR),
      'GALLERY_ALBUM_NAME_DUPLICATE',
    );
    await expectCode(setup().service.restore(ALBUM, ACTOR), 'GALLERY_ALBUM_NOT_DELETED');
  });
});
