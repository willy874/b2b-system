import { fetchDeleteWorkspaceMutation } from './fetcher';

export const getDeleteWorkspaceMutationOptions = () => ({
  mutationFn: fetchDeleteWorkspaceMutation,
});
