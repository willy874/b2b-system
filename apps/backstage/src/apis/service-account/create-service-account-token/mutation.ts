import { fetchServiceAccountTokenCreateMutation } from './fetcher';

export const getServiceAccountTokenCreateMutationOptions = () => ({
  mutationFn: fetchServiceAccountTokenCreateMutation,
});
