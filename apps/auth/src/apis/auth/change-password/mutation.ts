import { fetchChangePasswordMutation } from './fetcher';

export const getChangePasswordMutationOptions = () => ({
  mutationFn: fetchChangePasswordMutation,
});
