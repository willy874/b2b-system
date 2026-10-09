import { createUploadSources } from '@/core/upload';

/**
 * 檔案管理的上傳暫存區（`core/upload` 的 `createUploadSources`）。名稱 `file-upload` 是 IndexedDB 的名稱，
 * 不能改：已經有使用者暫存在裡面、等著被其他分頁接手的檔案。
 */
export const fileUploadSources = createUploadSources('file-upload');

/** 排隊中的上傳檔案（`batch.ts` 以暫存 key 存取）。 */
export const uploadSources = fileUploadSources.store;
