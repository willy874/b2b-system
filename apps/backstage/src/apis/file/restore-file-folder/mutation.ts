import { fetchFileFolderRestoreMutation } from './fetcher';

/** 還原刪除的資料夾（ADR-0025 R4）。 */
export const getFileFolderRestoreMutationOptions = () => ({
  mutationFn: fetchFileFolderRestoreMutation,
});
