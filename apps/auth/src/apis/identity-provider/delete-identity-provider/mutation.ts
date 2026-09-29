import { fetchDeleteIdentityProviderMutation } from './fetcher';

export const getDeleteIdentityProviderMutationOptions = () => ({
  mutationFn: fetchDeleteIdentityProviderMutation,
});
