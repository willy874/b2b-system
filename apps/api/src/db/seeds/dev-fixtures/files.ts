import { inArray } from 'drizzle-orm';

import { isImageVariantSource, storageKeyOf } from '@/modules/file/file.constants';

import type { ScriptDatabase } from '../../client';
import { files } from '../../schema';
import type { DevFixtureContext } from './context';
import { ago, fixtureId } from './context';
import type { PhotoSpec } from './images';
import { logoSvg, minimalPdf, photoContentType, renderPhoto } from './images';
import { addSeedStorageUsage, enqueueOutbox, SEED_JOB } from './media-common';
import type { SeedStorage } from './storage';
import { ensureFolder } from './trash';

/**
 * 檔案管理（docs/architecture/backend/09-file.md）：幾個資料夾，裡面混放照片、PDF 與 SVG。
 * 用來驗證「加入圖片庫」只收點陣圖（SVG、PDF 被略過，docs/architecture/backend/26-gallery.md §8），
 * 以及檔案的影像變體（`file.imageVariants`，由 api 的 worker 產生）。物件真的寫進物件儲存，下載得到內容。
 */

/** 資料夾路徑（`/` 分隔，上層要先出現）。名稱避開導覽截圖的示範資料（apps/e2e/tour/demo-data.ts）。 */
export const MEDIA_FOLDERS = ['設計素材', '設計素材/產品照片', '設計素材/活動照片 2026'] as const;
type MediaFolder = (typeof MEDIA_FOLDERS)[number] | '對外簡報';

type FileContent =
  | { kind: 'photo'; photo: PhotoSpec }
  | { kind: 'pdf'; text: string }
  | { kind: 'svg'; label: string };

export interface MediaFilePlan {
  key: string;
  folder: MediaFolder;
  name: string;
  content: FileContent;
  /** 上傳時間：幾天前。 */
  daysAgo: number;
}

const GPS_TAIPEI = { latitude: 25.047_675, longitude: 121.517_055 };
const GPS_KAOHSIUNG = { latitude: 22.616_545, longitude: 120.299_997 };

function photo(
  seed: number,
  label: string,
  shape: 'landscape' | 'portrait',
  format: PhotoSpec['format'],
  exif?: PhotoSpec['exif'],
): FileContent {
  const size =
    shape === 'landscape' ? { width: 1600, height: 1067 } : { width: 1067, height: 1600 };
  return { kind: 'photo', photo: { ...size, format, seed, label, exif } };
}

const CAMERA = {
  make: 'SONY',
  model: 'ILCE-7C',
  lensModel: 'FE 40mm F2.5 G',
  focalLength: 40,
  fNumber: 4,
  exposureTime: 1 / 200,
  iso: 320,
};

export const MEDIA_FILES: readonly MediaFilePlan[] = [
  {
    key: 'marketing/brand-guide',
    folder: '設計素材',
    name: '品牌識別手冊.pdf',
    content: { kind: 'pdf', text: 'Brand Guidelines v3 (dev seed)' },
    daysAgo: 40,
  },
  {
    key: 'marketing/logo',
    folder: '設計素材',
    name: 'logo.svg',
    content: { kind: 'svg', label: 'B2B' },
    daysAgo: 40,
  },
  {
    key: 'marketing/logo-mono',
    folder: '設計素材',
    name: 'logo_單色.svg',
    content: { kind: 'svg', label: 'MONO' },
    daysAgo: 39,
  },
  {
    key: 'marketing/key-visual',
    folder: '設計素材',
    name: '主視覺_2026.jpg',
    content: photo(101, 'KEY VISUAL 2026', 'landscape', 'jpeg', {
      dateTimeOriginal: '2026:02:10 14:05:00',
      offsetTimeOriginal: '+08:00',
      camera: CAMERA,
    }),
    daysAgo: 38,
  },
  {
    key: 'marketing/banner',
    folder: '設計素材',
    name: '官網橫幅.png',
    content: photo(102, 'WEB BANNER', 'landscape', 'png'),
    daysAgo: 30,
  },
  ...[1, 2, 3, 4].map((n): MediaFilePlan => ({
    key: `products/photo-${n}`,
    folder: '設計素材/產品照片',
    name: `產品_${String(n).padStart(3, '0')}.jpg`,
    content: photo(110 + n, `PRODUCT SHOT ${n}`, n % 2 ? 'landscape' : 'portrait', 'jpeg', {
      dateTimeOriginal: `2026:0${n + 3}:1${n} 10:30:00`,
      offsetTimeOriginal: '+08:00',
      camera: CAMERA,
      location: n === 2 ? GPS_TAIPEI : undefined,
    }),
    daysAgo: 25 - n,
  })),
  {
    key: 'products/spec-sheet',
    folder: '設計素材/產品照片',
    name: '產品規格表.pdf',
    content: { kind: 'pdf', text: 'Product Spec Sheet (dev seed)' },
    daysAgo: 20,
  },
  ...[1, 2, 3].map((n): MediaFilePlan => ({
    key: `events/photo-${n}`,
    folder: '設計素材/活動照片 2026',
    name: `DSC0${4410 + n}.jpg`,
    content: photo(120 + n, `EXPO DAY ${n}`, n === 2 ? 'portrait' : 'landscape', 'jpeg', {
      dateTimeOriginal: `2026:08:2${n} 1${n}:15:00`,
      offsetTimeOriginal: '+08:00',
      camera: CAMERA,
      location: GPS_KAOHSIUNG,
    }),
    daysAgo: 12 - n,
  })),
  {
    key: 'events/stage',
    folder: '設計素材/活動照片 2026',
    name: '舞台設計.webp',
    content: photo(124, 'STAGE DESIGN', 'landscape', 'webp'),
    daysAgo: 10,
  },
  {
    key: 'events/agenda',
    folder: '設計素材/活動照片 2026',
    name: '活動議程.pdf',
    content: { kind: 'pdf', text: 'Expo 2026 Agenda (dev seed)' },
    daysAgo: 14,
  },
  {
    key: 'events/floor-plan',
    folder: '設計素材/活動照片 2026',
    name: '場地平面圖.svg',
    content: { kind: 'svg', label: 'FLOOR' },
    daysAgo: 14,
  },
  {
    key: 'deck/cover',
    folder: '對外簡報',
    name: '簡報封面.jpg',
    content: photo(130, 'DECK COVER', 'landscape', 'jpeg'),
    daysAgo: 8,
  },
];

/** 檔案的內容與型別（純函式，同一份規劃永遠產生同一份位元組）。 */
export async function renderMediaFile(
  content: FileContent,
): Promise<{ data: Buffer; contentType: string }> {
  switch (content.kind) {
    case 'photo':
      return {
        data: await renderPhoto(content.photo),
        contentType: photoContentType(content.photo.format),
      };
    case 'pdf':
      return { data: minimalPdf(content.text), contentType: 'application/pdf' };
    case 'svg':
      return { data: Buffer.from(logoSvg(content.label, 7)), contentType: 'image/svg+xml' };
  }
}

function fileIdOf(key: string): string {
  return fixtureId(`file:media/${key}`);
}

export interface MediaFileFixtureResult {
  folders: number;
  files: number;
  created: number;
}

export async function seedMediaFileFixtures(
  db: ScriptDatabase,
  ctx: DevFixtureContext,
  storage: SeedStorage,
): Promise<MediaFileFixtureResult> {
  const folderIds = new Map<MediaFolder, string>();
  for (const path of MEDIA_FOLDERS) {
    const slash = path.lastIndexOf('/');
    const parentId =
      slash === -1 ? null : (folderIds.get(path.slice(0, slash) as MediaFolder) ?? null);
    // oxlint-disable-next-line no-await-in-loop -- 上層要先建好
    folderIds.set(path, await ensureFolder(db, ctx, path.slice(slash + 1), parentId));
  }
  // dev-fixtures/trash.ts 建立的根目錄資料夾
  folderIds.set('對外簡報', await ensureFolder(db, ctx, '對外簡報'));

  const existing = new Set(
    (
      await db
        .select({ id: files.id })
        .from(files)
        .where(
          inArray(
            files.id,
            MEDIA_FILES.map((plan) => fileIdOf(plan.key)),
          ),
        )
    ).map((row) => row.id),
  );

  const rows: (typeof files.$inferInsert)[] = [];
  for (const plan of MEDIA_FILES) {
    const id = fileIdOf(plan.key);
    if (existing.has(id)) continue;
    // oxlint-disable-next-line no-await-in-loop -- 依序產生，同時只有一個檔案在記憶體
    const { data, contentType } = await renderMediaFile(plan.content);
    // oxlint-disable-next-line no-await-in-loop -- 同上
    const etag = await storage.put(storageKeyOf(id), data, contentType);
    const uploadedAt = ago(ctx.now, plan.daysAgo);
    rows.push({
      id,
      name: plan.name,
      contentType,
      size: data.length,
      storageKey: storageKeyOf(id),
      etag,
      status: 'ready',
      uploadedAt,
      // 點陣圖由 worker 產生預覽與圖示（docs/architecture/backend/09-file.md §5.4）；PDF、SVG 沒有變體
      variantStatus: isImageVariantSource(contentType) ? 'pending' : 'none',
      folderId: folderIds.get(plan.folder) ?? null,
      createdAt: uploadedAt,
      createdBy: ctx.actorId,
      updatedAt: uploadedAt,
      updatedBy: ctx.actorId,
    });
  }

  const created = await db.transaction(async (tx) => {
    if (rows.length === 0) return [];
    const inserted = await tx
      .insert(files)
      .values(rows)
      .onConflictDoNothing()
      .returning({ id: files.id, size: files.size, variantStatus: files.variantStatus });
    await addSeedStorageUsage(
      tx,
      inserted.reduce((sum, row) => sum + row.size, 0),
    );
    await enqueueOutbox(
      tx,
      SEED_JOB.FILE_IMAGE_VARIANTS,
      inserted.filter((row) => row.variantStatus === 'pending').map((row) => ({ fileId: row.id })),
    );
    return inserted;
  });

  return { folders: MEDIA_FOLDERS.length, files: MEDIA_FILES.length, created: created.length };
}
