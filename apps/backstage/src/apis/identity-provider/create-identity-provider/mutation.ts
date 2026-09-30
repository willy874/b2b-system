import { fetchCreateIdentityProviderMutation } from './fetcher';

export const getCreateIdentityProviderMutationOptions = () => ({
  mutationFn: fetchCreateIdentityProviderMutation,
});
