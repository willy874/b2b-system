import { fetchCreateAdminMutation } from './fetcher';

export const getCreateAdminMutationOptions = () => ({
  mutationFn: fetchCreateAdminMutation,
});
