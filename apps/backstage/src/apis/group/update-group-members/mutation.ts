import { fetchGroupMembersUpdateMutation } from './fetcher';

export const getGroupMembersUpdateMutationOptions = () => ({
  mutationFn: fetchGroupMembersUpdateMutation,
});
