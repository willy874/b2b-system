import { fetchFileRestoreMutation } from './fetcher';

/** 還原刪除的檔案（docs/architecture/backend/14-revisions.md §9 R4）。 */
export const getFileRestoreMutationOptions = () => ({ mutationFn: fetchFileRestoreMutation });
