import { fetchCreateImageFromSourceMutation } from './fetcher';

/** 從其他來源（檔案管理、圖片庫、最近使用）複製成一張新的圖片（docs/architecture/backend/25-image.md §15.2）。 */
export const getCreateImageFromSourceMutationOptions = () => ({
  mutationFn: fetchCreateImageFromSourceMutation,
});
