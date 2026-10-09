import { and, eq, inArray, isNull, sql } from 'drizzle-orm';

import { RESOURCE_TYPE } from '@/core/resource';
import { GALLERY_TAG_SCOPE, uploadKeyOf } from '@/modules/gallery/gallery.constants';

import type { ScriptDatabase } from '../../client';
import { comments, galleryAlbumItems, galleryAlbums, galleryItems, watches } from '../../schema';
import type { TagColor } from '../../schema';
import type { DevFixtureContext } from './context';
import { ago, createRandom, fixtureId } from './context';
import type { PhotoCamera, PhotoLocation, PhotoSpec } from './images';
import { photoContentType, renderPhoto } from './images';
import { addSeedStorageUsage, enqueueOutbox, SEED_JOB } from './media-common';
import type { SeedStorage } from './storage';
import { assignTag, ensureTag } from './tags';

/**
 * 圖片庫（docs/architecture/backend/26-gallery.md）：數十張在程式裡產生的照片，直式、橫式、正方形、全景都有，
 * 拍攝時間跨 14 個月（日期捲軸與時間軸看得出分月）。多數帶 EXIF（相機、鏡頭、曝光），約三分之一帶 GPS（驗證原檔的位置被移除），
 * 幾張 PNG 沒有 EXIF（以加入時間排序）、一張與另一張內容相同（重複的提示，D7）、兩張在回收桶。
 *
 * 寫法與使用者上傳相同的終點：物件放在 `gallery/<id>/upload`、列是 `processing`、同一個交易排入 `gallery.process`，
 * 由 api 的 worker 讀 EXIF、移除 GPS、寫原檔與變體（§5）。seed 不自己產生變體。
 */

/** 拍攝時間的錨點：固定的日期（不用執行當下的時間），同一份規格永遠產生同一份位元組。 */
const PHOTO_EPOCH = Date.UTC(2026, 8, 28, 0, 0, 0);
const DAY_MS = 24 * 60 * 60 * 1000;
const GALLERY_SEED = 20_261_009;
export const GALLERY_ITEM_COUNT = 42;
/** 這幾張建立之後放進回收桶（刪除時間：幾天前）。 */
const DELETED_ITEMS: ReadonlyMap<number, number> = new Map([
  [7, 2],
  [23, 5],
]);
/** 最後一張與第 5 張（index 4）的內容相同：詳情顯示「內容相同的其他圖」。 */
const DUPLICATE_OF: ReadonlyMap<number, number> = new Map([[GALLERY_ITEM_COUNT - 1, 4]]);

type CategoryKey = 'brand' | 'product' | 'event' | 'office' | 'trip';

const CATEGORIES: readonly {
  key: CategoryKey;
  label: string;
  title: string;
  description: string | null;
}[] = [
  { key: 'brand', label: 'BRAND', title: '品牌素材', description: '官網與簡報共用的主視覺' },
  { key: 'product', label: 'PRODUCT', title: '產品照', description: '白底以外的情境照' },
  { key: 'event', label: 'EVENT', title: '活動紀錄', description: null },
  { key: 'office', label: 'OFFICE', title: '辦公室日常', description: null },
  { key: 'trip', label: 'TRIP', title: '員工旅遊', description: '可對外分享的團體照請先確認授權' },
];

const CAMERAS: readonly PhotoCamera[] = [
  {
    make: 'FUJIFILM',
    model: 'X-T5',
    lensMake: 'FUJIFILM',
    lensModel: 'XF23mmF1.4 R LM WR',
    focalLength: 23,
    focalLength35mm: 35,
    fNumber: 2,
    exposureTime: 1 / 250,
    iso: 200,
  },
  {
    make: 'SONY',
    model: 'ILCE-7M4',
    lensMake: 'SONY',
    lensModel: 'FE 24-70mm F2.8 GM II',
    focalLength: 50,
    focalLength35mm: 50,
    fNumber: 4,
    exposureTime: 1 / 125,
    iso: 800,
    flashFired: true,
  },
  {
    make: 'Canon',
    model: 'EOS R6m2',
    lensModel: 'RF85mm F2 MACRO IS STM',
    focalLength: 85,
    fNumber: 2.8,
    exposureTime: 1 / 500,
    iso: 100,
  },
  {
    make: 'Apple',
    model: 'iPhone 17 Pro',
    lensMake: 'Apple',
    lensModel: 'iPhone 17 Pro back triple camera 6.86mm f/1.78',
    focalLength: 6.9,
    focalLength35mm: 24,
    fNumber: 1.8,
    exposureTime: 1 / 60,
    iso: 64,
  },
];

const LOCATIONS: readonly PhotoLocation[] = [
  { latitude: 25.033_964, longitude: 121.564_472 },
  { latitude: 24.147_736, longitude: 120.673_648 },
  { latitude: 22.627_278, longitude: 120.301_435 },
  { latitude: 35.658_581, longitude: 139.745_433 },
  { latitude: 23.857_222, longitude: 120.915_833 },
];

/** 版型：寬 × 高（長邊 ≤ 2400，處理快、仍有 large 的尺寸）。 */
const SHAPES = {
  landscape: { width: 1800, height: 1200 },
  portrait: { width: 1200, height: 1800 },
  square: { width: 1400, height: 1400 },
  panorama: { width: 2400, height: 900 },
} as const;
type Shape = keyof typeof SHAPES;

export interface GalleryItemPlan {
  /** 固定 id 的 key（`fixtureId('gallery:<key>')`）。 */
  key: string;
  category: CategoryKey;
  title: string;
  description: string | null;
  shape: Shape;
  photo: PhotoSpec;
  /** 加入圖片庫的時間（沒有 EXIF 的圖以它排序）。 */
  createdAt: Date;
  /** 上傳者：dev 使用者的序號（1 起算）；0 是操作者（super-admin）。 */
  uploader: number;
  albums: string[];
  tags: string[];
  /** 放進回收桶：幾天前刪除；null 是沒刪除。 */
  deletedDaysAgo: number | null;
}

export interface GalleryAlbumPlan {
  key: string;
  name: string;
  description: string | null;
  /** 封面（圖片的 key）；null 時用相簿裡最新的一張。 */
  cover: string | null;
}

export const GALLERY_ALBUMS: readonly GalleryAlbumPlan[] = [
  { key: 'brand', name: '品牌素材', description: 'Logo、主視覺與配色', cover: null },
  { key: 'product', name: '產品照', description: '新品上架與情境照', cover: 'photo-07' },
  { key: 'event', name: '活動紀錄', description: '發表會、展覽與內部活動', cover: null },
  { key: 'highlights', name: '年度精選', description: '跨相簿挑出來的代表作', cover: 'photo-01' },
  // 沒有圖的相簿：封面與張數的空狀態
  { key: 'inbox', name: '待整理', description: null, cover: null },
];

const CATEGORY_ALBUM: Readonly<Partial<Record<CategoryKey, string>>> = {
  brand: 'brand',
  product: 'product',
  event: 'event',
};

export const GALLERY_TAGS: readonly { key: string; name: string; color: TagColor }[] = [
  { key: 'featured', name: '精選', color: 'brand' },
  { key: 'social', name: '社群可用', color: 'success' },
  { key: 'license', name: '需要授權', color: 'warning' },
  { key: 'retouch', name: '待修圖', color: 'danger' },
];

/** 留言：`item` 是圖片的 key、`author` 是 dev 使用者序號（dev01～dev35 都是 active）。 */
export const GALLERY_COMMENTS: readonly {
  key: string;
  item: string;
  author: number;
  body: string;
  hoursAfter: number;
}[] = [
  { key: 'c1', item: 'photo-01', author: 3, body: '這張可以當首頁的主視覺嗎？', hoursAfter: 5 },
  { key: 'c2', item: 'photo-01', author: 21, body: '可以，記得右下角留白放標語。', hoursAfter: 9 },
  {
    key: 'c3',
    item: 'photo-02',
    author: 22,
    body: '產品的色偏有點重，等修圖後再上架。',
    hoursAfter: 30,
  },
  {
    key: 'c4',
    item: 'photo-05',
    author: 14,
    body: '這張和另一張重複上傳了，留哪一張？',
    hoursAfter: 48,
  },
  { key: 'c5', item: 'photo-05', author: 4, body: '留這張，另一張之後刪掉。', hoursAfter: 52 },
  {
    key: 'c6',
    item: 'photo-11',
    author: 25,
    body: '活動照的人像使用要先問過本人。',
    hoursAfter: 20,
  },
  {
    key: 'c7',
    item: 'photo-11',
    author: 1,
    body: '已確認，同意書在專案文件資料夾。',
    hoursAfter: 26,
  },
  { key: 'c8', item: 'photo-11', author: 25, body: '收到，謝謝！', hoursAfter: 27 },
];

function pick<T>(items: readonly T[], random: () => number): T {
  return items[Math.floor(random() * items.length)] as T;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** EXIF 的 `YYYY:MM:DD HH:MM:SS`（以 UTC 欄位寫出：規格裡的時間就是拍攝當地的時間）。 */
function exifDateOf(date: Date): string {
  return `${date.getUTCFullYear()}:${pad(date.getUTCMonth() + 1)}:${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
}

function shapeOf(roll: number): Shape {
  if (roll < 0.5) return 'landscape';
  if (roll < 0.8) return 'portrait';
  if (roll < 0.92) return 'square';
  return 'panorama';
}

/**
 * 圖片庫的規劃（純函式，固定亂數種子）：每次呼叫得到同一份結果。
 * 拍攝時間依序號平均分到 14 個月（新到舊），月內的日與時刻隨機。
 */
export function buildGalleryPlan(): GalleryItemPlan[] {
  const random = createRandom(GALLERY_SEED);
  const counters = new Map<CategoryKey, number>();
  const plans: GalleryItemPlan[] = [];
  for (let index = 0; index < GALLERY_ITEM_COUNT; index += 1) {
    const key = `photo-${pad(index + 1)}`;
    const duplicateOf = DUPLICATE_OF.get(index);
    const source = duplicateOf === undefined ? undefined : plans[duplicateOf];
    // 亂數依序消耗，重複的那張也照樣抽，才不會影響後面的圖
    const rolls = Array.from({ length: 8 }, () => random());
    const category = source
      ? (CATEGORIES.find((entry) => entry.key === source.category) ?? CATEGORIES[0])
      : CATEGORIES[index % CATEGORIES.length];
    if (!category) throw new Error('CATEGORIES 不可為空');
    const count = (counters.get(category.key) ?? 0) + 1;
    counters.set(category.key, count);

    const monthsAgo = Math.floor((index * 14) / GALLERY_ITEM_COUNT);
    const takenAt = new Date(PHOTO_EPOCH);
    takenAt.setUTCMonth(takenAt.getUTCMonth() - monthsAgo);
    takenAt.setUTCDate(1 + Math.floor((rolls[0] ?? 0) * 27));
    takenAt.setUTCHours(8 + Math.floor((rolls[1] ?? 0) * 11), Math.floor((rolls[2] ?? 0) * 60));

    // 每 6 張有 1 張是沒有 EXIF 的 PNG（螢幕截圖、設計稿匯出）
    const hasExif = index % 6 !== 5;
    const shape = shapeOf(rolls[3] ?? 0);
    const format = !hasExif ? 'png' : index % 11 === 3 ? 'webp' : 'jpeg';
    const camera = (rolls[4] ?? 0) < 0.85 ? pick(CAMERAS, () => rolls[5] ?? 0) : undefined;
    const location = index % 3 === 0 ? pick(LOCATIONS, () => rolls[6] ?? 0) : undefined;
    const photo: PhotoSpec = source
      ? source.photo
      : {
          ...SHAPES[shape],
          format,
          seed: index + 1,
          label: `${category.label} ${pad(count)} - ${takenAt.getUTCFullYear()}-${pad(takenAt.getUTCMonth() + 1)}`,
          exif: hasExif
            ? {
                dateTimeOriginal: exifDateOf(takenAt),
                // 每 4 張有 1 張沒有時區偏移：以租戶的預設時區解讀（§5.2）
                offsetTimeOriginal: index % 4 === 1 ? undefined : '+08:00',
                camera,
                location,
              }
            : undefined,
        };

    // 拍完幾天後才上傳；沒有 EXIF 的就以這個時間排序
    const createdAt = new Date(
      Math.min(takenAt.getTime() + (1 + Math.floor((rolls[7] ?? 0) * 9)) * DAY_MS, PHOTO_EPOCH),
    );
    const albums = [CATEGORY_ALBUM[category.key]].filter((album): album is string => !!album);
    // 每 4 張挑 1 張進「年度精選」：同一張圖在兩個相簿
    if (index % 4 === 0) albums.push('highlights');
    const tags: string[] = [];
    if (index % 4 === 0) tags.push('featured');
    if (category.key === 'event' || category.key === 'office') tags.push('social');
    if (category.key === 'trip' || index % 7 === 2) tags.push('license');
    if (index % 9 === 1) tags.push('retouch');

    plans.push({
      key,
      category: category.key,
      title: source ? `${source.title}（重複上傳）` : `${category.title} ${pad(count)}`,
      description: source ? null : index % 2 === 0 ? category.description : null,
      shape: source ? source.shape : shape,
      photo,
      createdAt,
      uploader: [0, 0, 1, 21, 22][index % 5] ?? 0,
      albums,
      tags,
      deletedDaysAgo: DELETED_ITEMS.get(index) ?? null,
    });
  }
  return plans;
}

/** 圖片的固定 id。 */
export function galleryItemIdOf(key: string): string {
  return fixtureId(`gallery:${key}`);
}

export interface GalleryFixtureResult {
  /** 這次新寫入（排入處理）的張數。 */
  created: number;
  total: number;
  /** 在回收桶裡的張數。 */
  deleted: number;
  albums: number;
  tags: number;
  comments: number;
}

export async function seedGalleryFixtures(
  db: ScriptDatabase,
  ctx: DevFixtureContext,
  storage: SeedStorage,
): Promise<GalleryFixtureResult> {
  const plans = buildGalleryPlan();
  const uploaderOf = (serial: number) =>
    serial === 0 ? ctx.actorId : (ctx.userIds[serial - 1] ?? ctx.actorId);

  const existing = new Set(
    (
      await db
        .select({ id: galleryItems.id })
        .from(galleryItems)
        .where(
          inArray(
            galleryItems.id,
            plans.map((plan) => galleryItemIdOf(plan.key)),
          ),
        )
    ).map((row) => row.id),
  );
  const missing = plans.filter((plan) => !existing.has(galleryItemIdOf(plan.key)));

  // 物件先寫：列與工作在同一個交易，worker 拿到工作時物件一定已經在
  const sizes = new Map<string, number>();
  for (const plan of missing) {
    // oxlint-disable-next-line no-await-in-loop -- 依序產生，同時只有一張圖在記憶體
    const data = await renderPhoto(plan.photo);
    // oxlint-disable-next-line no-await-in-loop -- 同上
    await storage.put(
      uploadKeyOf(galleryItemIdOf(plan.key)),
      data,
      photoContentType(plan.photo.format),
    );
    sizes.set(plan.key, data.length);
  }

  const albumIdByKey = await ensureAlbums(db, ctx);

  const created = await db.transaction(async (tx) => {
    if (missing.length === 0) return [];
    const inserted = await tx
      .insert(galleryItems)
      .values(
        missing.map((plan) => {
          const deletedAt = plan.deletedDaysAgo === null ? null : ago(ctx.now, plan.deletedDaysAgo);
          const uploader = uploaderOf(plan.uploader);
          return {
            id: galleryItemIdOf(plan.key),
            title: plan.title,
            description: plan.description,
            status: 'processing' as const,
            contentType: photoContentType(plan.photo.format),
            size: sizes.get(plan.key) ?? 0,
            width: plan.photo.width,
            height: plan.photo.height,
            source: 'upload',
            queuedAt: ctx.now,
            createdAt: plan.createdAt,
            createdBy: uploader,
            updatedAt: deletedAt ?? plan.createdAt,
            updatedBy: deletedAt ? ctx.actorId : uploader,
            deletedAt,
          };
        }),
      )
      .onConflictDoNothing()
      .returning({ id: galleryItems.id, size: galleryItems.size });
    await addSeedStorageUsage(
      tx,
      inserted.reduce((sum, row) => sum + row.size, 0),
    );
    await enqueueOutbox(
      tx,
      SEED_JOB.GALLERY_PROCESS,
      inserted.map((row) => ({ itemId: row.id })),
    );
    return inserted.map((row) => row.id);
  });

  // 相簿的關聯只寫給這次新建的圖：之後在畫面上移出相簿的不會被補回來
  const createdIds = new Set(created);
  const albumRows = plans.flatMap((plan) =>
    createdIds.has(galleryItemIdOf(plan.key))
      ? plan.albums.flatMap((album) => {
          const albumId = albumIdByKey.get(album);
          return albumId
            ? [
                {
                  albumId,
                  itemId: galleryItemIdOf(plan.key),
                  addedBy: ctx.actorId,
                  addedAt: plan.createdAt,
                },
              ]
            : [];
        })
      : [],
  );
  if (albumRows.length) await db.insert(galleryAlbumItems).values(albumRows).onConflictDoNothing();

  // 封面：只設給還沒有封面的相簿，而且那張圖要在相簿裡（GALLERY_ALBUM_COVER_INVALID 的規則）
  for (const album of GALLERY_ALBUMS) {
    const albumId = albumIdByKey.get(album.key);
    if (!album.cover || !albumId) continue;
    const coverId = galleryItemIdOf(album.cover);
    // oxlint-disable-next-line no-await-in-loop -- 相簿數量少，依序執行
    await db
      .update(galleryAlbums)
      .set({ coverItemId: coverId })
      .where(
        and(
          eq(galleryAlbums.id, albumId),
          isNull(galleryAlbums.coverItemId),
          sql`exists (select 1 from ${galleryAlbumItems} where ${galleryAlbumItems.albumId} = ${albumId} and ${galleryAlbumItems.itemId} = ${coverId})`,
        ),
      );
  }

  // 標籤（標籤組 gallery、資源類型 galleryItem；§11.7）
  let tagAssignments = 0;
  for (const [index, tag] of GALLERY_TAGS.entries()) {
    // oxlint-disable-next-line no-await-in-loop -- seed 腳本，筆數少，依序執行
    const tagId = await ensureTag(db, ctx, GALLERY_TAG_SCOPE, tag.name, tag.color, index);
    const ids = plans
      .filter((plan) => plan.tags.includes(tag.key) && createdIds.has(galleryItemIdOf(plan.key)))
      .map((plan) => galleryItemIdOf(plan.key));
    // oxlint-disable-next-line no-await-in-loop -- 同上
    tagAssignments += await assignTag(db, ctx, tagId, RESOURCE_TYPE.GALLERY_ITEM, ids);
  }

  const commentCount = await seedComments(db, ctx, plans);

  return {
    created: created.length,
    total: plans.length,
    deleted: plans.filter((plan) => plan.deletedDaysAgo !== null).length,
    albums: albumIdByKey.size,
    tags: tagAssignments,
    comments: commentCount,
  };
}

/** 相簿：同名（不分大小寫、沒刪除）的已存在就沿用它，否則以固定 id 建立。 */
async function ensureAlbums(
  db: ScriptDatabase,
  ctx: DevFixtureContext,
): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  for (const [index, album] of GALLERY_ALBUMS.entries()) {
    const createdAt = ago(ctx.now, 60 - index);
    // oxlint-disable-next-line no-await-in-loop -- 相簿數量少，依序執行
    const [found] = await db
      .select({ id: galleryAlbums.id })
      .from(galleryAlbums)
      .where(
        and(
          sql`lower(${galleryAlbums.name}) = lower(${album.name})`,
          isNull(galleryAlbums.deletedAt),
        ),
      )
      .limit(1);
    if (found) {
      ids.set(album.key, found.id);
      continue;
    }
    const id = fixtureId(`gallery-album:${album.key}`);
    // oxlint-disable-next-line no-await-in-loop -- 同上
    await db
      .insert(galleryAlbums)
      .values({
        id,
        name: album.name,
        description: album.description,
        createdAt,
        createdBy: ctx.actorId,
        updatedAt: createdAt,
        updatedBy: ctx.actorId,
      })
      .onConflictDoNothing();
    ids.set(album.key, id);
  }
  return ids;
}

/** 留言與關注（docs/architecture/backend/24-comment.md）：作者自動關注（D8）。只寫給可以登入的作者。 */
async function seedComments(
  db: ScriptDatabase,
  ctx: DevFixtureContext,
  plans: readonly GalleryItemPlan[],
): Promise<number> {
  const planByKey = new Map(plans.map((plan) => [plan.key, plan]));
  const rows = GALLERY_COMMENTS.flatMap((comment) => {
    const plan = planByKey.get(comment.item);
    const authorId = ctx.userIds[comment.author - 1];
    if (!plan || !authorId || !ctx.activeUserIds.has(authorId)) return [];
    const createdAt = new Date(
      Math.min(plan.createdAt.getTime() + comment.hoursAfter * 3_600_000, ctx.now.getTime()),
    );
    return [
      {
        id: fixtureId(`gallery-comment:${comment.key}`),
        resourceType: RESOURCE_TYPE.GALLERY_ITEM,
        resourceId: galleryItemIdOf(comment.item),
        authorId,
        body: comment.body,
        createdAt,
      },
    ];
  });
  if (rows.length === 0) return 0;
  await db.insert(comments).values(rows).onConflictDoNothing();
  await db
    .insert(watches)
    .values(
      rows.map((row) => ({
        resourceType: row.resourceType,
        resourceId: row.resourceId,
        userId: row.authorId,
        createdAt: row.createdAt,
      })),
    )
    .onConflictDoNothing();
  return rows.length;
}
