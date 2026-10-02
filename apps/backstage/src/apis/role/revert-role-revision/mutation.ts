import { fetchRoleRevertRevisionMutation } from './fetcher';

/** 把角色還原到某一版（docs/architecture/backend/14-revisions.md §9 R5）：當成一次新的更新，產生新的一版。 */
export const getRoleRevertRevisionMutationOptions = () => ({
  mutationFn: fetchRoleRevertRevisionMutation,
});
