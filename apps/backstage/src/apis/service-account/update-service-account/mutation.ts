import { fetchServiceAccountUpdateMutation } from './fetcher';

export const getServiceAccountUpdateMutationOptions = () => ({
  mutationFn: fetchServiceAccountUpdateMutation,
});
