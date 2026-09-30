import { fetchUserRestoreMutation } from './fetcher';

/** 還原刪除的使用者（ADR-0025 D6）。 */
export const getUserRestoreMutationOptions = () => ({ mutationFn: fetchUserRestoreMutation });
