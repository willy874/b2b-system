import { fetchFileRestoreMutation } from './fetcher';

/** 還原刪除的檔案（ADR-0025 R4）。 */
export const getFileRestoreMutationOptions = () => ({ mutationFn: fetchFileRestoreMutation });
