import { fetchUserRestoreMutation } from './fetcher';

/** 還原刪除的使用者（docs/architecture/backend/14-revisions.md §9.2 D6）。 */
export const getUserRestoreMutationOptions = () => ({ mutationFn: fetchUserRestoreMutation });
