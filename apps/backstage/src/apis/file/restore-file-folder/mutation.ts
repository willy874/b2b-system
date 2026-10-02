import { fetchFileFolderRestoreMutation } from './fetcher';

/** 還原刪除的資料夾（docs/architecture/backend/14-revisions.md §9 R4）。 */
export const getFileFolderRestoreMutationOptions = () => ({
  mutationFn: fetchFileFolderRestoreMutation,
});
