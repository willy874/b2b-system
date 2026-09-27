import { z } from 'zod';

import { defineSchema } from '@/core/validation';

import { MAX_FOLDER_DEPTH, MAX_FOLDER_PATHS, MAX_MOVE_ITEMS } from '../file.constants';
import { FileNameSchema } from './create-file-upload.dto';

/** 資料夾名稱：規則同檔名（不可含路徑分隔字元、控制字元），另外排除 `.` 與 `..`。 */
export const FileFolderNameSchema = FileNameSchema.refine((name) => name !== '.' && name !== '..', {
  message: 'must not be . or ..',
});

/** 目的地：資料夾 id，或 null 表示根目錄。 */
const FolderRefSchema = z.string().uuid().nullable();

export const FileFolderSchema = defineSchema(
  'FileFolder',
  z.object({
    id: z.string().uuid(),
    name: z.string(),
    /** 上層資料夾；null 是根目錄。 */
    parentId: z.string().uuid().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  }),
);

/** 全部的資料夾（扁平清單）：前端自己組成樹，麵包屑、樹狀面板、移動對話框共用同一份。 */
export const FileFolderListSchema = defineSchema(
  'FileFolderList',
  z.object({ items: z.array(FileFolderSchema) }),
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
