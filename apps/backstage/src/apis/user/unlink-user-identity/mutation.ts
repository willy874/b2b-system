import { fetchUnlinkUserIdentityMutation } from './fetcher';

export const getUnlinkUserIdentityMutationOptions = () => ({
  mutationFn: fetchUnlinkUserIdentityMutation,
});
