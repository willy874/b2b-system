import { fetchRoleRestoreMutation } from './fetcher';

/** 還原刪除的角色（ADR-0025 R3）：原本的持有者一併恢復。 */
export const getRoleRestoreMutationOptions = () => ({ mutationFn: fetchRoleRestoreMutation });
