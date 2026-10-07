import { z } from 'zod';

import { defineSchema } from '@/core/validation';
import { FILE_FOLDER_KINDS } from '@/db/schema';
import { TagSummarySchema } from '@/modules/tag/dto/tag.dto';

import { MAX_FOLDER_DEPTH, MAX_FOLDER_PATHS, MAX_MOVE_ITEMS } from '../file.constants';
import { FileNameSchema } from './create-file-upload.dto';

/** 資料夾名稱：規則同檔名（不可含路徑分隔字元、控制字元），另外排除 `.` 與 `..`。 */
export const FileFolderNameSchema = FileNameSchema.refine((name) => name !== '.' && name !== '..', {
  message: 'must not be . or ..',
});

/** 目的地：資料夾 id，或 null 表示根目錄。 */
const FolderRefSchema = z.string().uuid().nullable();

/** 操作者對資料夾的能力（docs/architecture/iam/06-resource-grants.md §7）；前端只讀旗標，不重算。 */
export const FileFolderCapabilitiesSchema = defineSchema(
  'FileFolderCapabilities',
  z.object({
    /** false = 鎖住：看得到資料夾，看不到裡面的檔案（§5.1）。 */
    canRead: z.boolean(),
    /** 在裡面上傳、建立子資料夾。 */
    canCreate: z.boolean(),
    /** 改名、移動這個資料夾。 */
    canUpdate: z.boolean(),
    /** 遞迴刪除這個資料夾（子樹的附加條件在刪除時才檢查）。 */
    canDelete: z.boolean(),
    /** 管理這個資料夾的授權。 */
    canShare: z.boolean(),
  }),
);

export const FileFolderSchema = defineSchema(
  'FileFolder',
  z.object({
    id: z.string().uuid(),
    name: z.string(),
    /** 上層資料夾；null 是根目錄。 */
    parentId: z.string().uuid().nullable(),
    /** `normal` 以外是系統資料夾：共用、私人（容器）、個人資料夾（docs/architecture/iam/06-resource-grants.md §12）。 */
    kind: z.enum(FILE_FOLDER_KINDS),
    /** false = 中斷繼承（私人資料夾）：上層的資料夾授權不再流到這裡（§3.3）。 */
    inheritGrants: z.boolean(),
    /** 操作者對這個資料夾有一筆待審的存取申請（§6.5）。 */
    hasPendingAccessRequest: z.boolean(),
    capabilities: FileFolderCapabilitiesSchema,
    /** 貼著的標籤（`file` 標籤組，與檔案共用；docs/architecture/backend/18-tag.md §7.2 D1、D6）。 */
    tags: z.array(TagSummarySchema),
    createdAt: z.string(),
    updatedAt: z.string(),
  }),
);

/**
 * 還原資料夾的結果（`POST /file-folders/:id/restore`，docs/architecture/backend/13-trash.md §7.1）：
 * 還原後的資料夾，加上同一批一起回來的數量與因物件已不在而留在回收桶的檔案數。
 */
export const RestoredFileFolderSchema = defineSchema(
  'RestoredFileFolder',
  FileFolderSchema.extend({
    /** 一起還原的資料夾數（含自己）。 */
    foldersRestored: z.number().int(),
    /** 一起還原的檔案數。 */
    filesRestored: z.number().int(),
    /** 同一批刪除、但物件儲存裡已沒有內容的檔案數：維持刪除，之後在回收桶的「檔案」分頁個別出現。 */
    filesSkipped: z.number().int(),
  }),
);

/** 全部資料夾（扁平清單；沒有權限的標成鎖住）：前端自己組成樹，麵包屑、樹狀面板、移動對話框共用同一份。 */
export const FileFolderListSchema = defineSchema(
  'FileFolderList',
  z.object({
    items: z.array(FileFolderSchema),
    /** 根目錄只由全域權限決定（§3.1）。 */
    rootCapabilities: z.object({ canCreate: z.boolean() }),
    /** 操作者自己的個人資料夾（§12）；還沒建立（沒有檔案管理器權限）時為 null。前端的預設位置。 */
    personalFolderId: z.string().uuid().nullable(),
  }),
);

export const CreateFileFolderSchema = defineSchema(
  'CreateFileFolderRequest',
  z.object({ name: FileFolderNameSchema, parentId: FolderRefSchema.default(null) }),
);

export const UpdateFileFolderSchema = defineSchema(
  'UpdateFileFolderRequest',
  z.object({ name: FileFolderNameSchema }),
);

/**
 * 上傳資料夾時一次建好整棵結構：每條路徑是從 `parentId` 起算的各層名稱。
 * 已存在的同名資料夾（不分大小寫）直接沿用，所以同一個資料夾重傳是合併而不是失敗。
 */
export const EnsureFileFolderPathsSchema = defineSchema(
  'EnsureFileFolderPathsRequest',
  z.object({
    parentId: FolderRefSchema.default(null),
    paths: z
      .array(z.array(FileFolderNameSchema).min(1).max(MAX_FOLDER_DEPTH))
      .min(1)
      .max(MAX_FOLDER_PATHS),
  }),
);

export const FileFolderPathsSchema = defineSchema(
  'FileFolderPaths',
  z.object({
    /** 與請求的 `paths` 同順序：每條路徑最後一層的資料夾 id。 */
    items: z.array(z.object({ path: z.array(z.string()), id: z.string().uuid() })),
  }),
);

const IdListSchema = z
  .array(z.string().uuid())
  .max(MAX_MOVE_ITEMS)
  .default([])
  .refine((ids) => new Set(ids).size === ids.length, { message: 'duplicate id' });

export const MoveFileItemsSchema = defineSchema(
  'MoveFileItemsRequest',
  z
    .object({
      fileIds: IdListSchema,
      folderIds: IdListSchema,
      /** 移到哪個資料夾；null 是根目錄。 */
      targetFolderId: FolderRefSchema,
    })
    .refine((dto) => dto.fileIds.length + dto.folderIds.length > 0, {
      message: 'nothing to move',
    }),
);

export const MoveFileItemsResultSchema = defineSchema(
  'MoveFileItemsResult',
  z.object({
    /** 實際移動的數量（已刪除、或本來就在目的地的不算）。 */
    movedFiles: z.number().int(),
    movedFolders: z.number().int(),
  }),
);

export type FileFolderDto = z.infer<typeof FileFolderSchema>;
export type FileFolderListDto = z.infer<typeof FileFolderListSchema>;
export type CreateFileFolderDto = z.infer<typeof CreateFileFolderSchema>;
export type UpdateFileFolderDto = z.infer<typeof UpdateFileFolderSchema>;
export type EnsureFileFolderPathsDto = z.infer<typeof EnsureFileFolderPathsSchema>;
export type FileFolderPathsDto = z.infer<typeof FileFolderPathsSchema>;
export type MoveFileItemsDto = z.infer<typeof MoveFileItemsSchema>;
export type MoveFileItemsResultDto = z.infer<typeof MoveFileItemsResultSchema>;
export type RestoredFileFolderDto = z.infer<typeof RestoredFileFolderSchema>;
