import { fetchRoleRestoreMutation } from './fetcher';

/** 還原刪除的角色（docs/architecture/backend/14-revisions.md §9 R3）：原本的持有者一併恢復。 */
export const getRoleRestoreMutationOptions = () => ({ mutationFn: fetchRoleRestoreMutation });
