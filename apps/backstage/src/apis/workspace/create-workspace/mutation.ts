import { fetchCreateWorkspaceMutation } from './fetcher';

export const getCreateWorkspaceMutationOptions = () => ({
  mutationFn: fetchCreateWorkspaceMutation,
});
