import { fetchServiceAccountDeleteMutation } from './fetcher';

export const getServiceAccountDeleteMutationOptions = () => ({
  mutationFn: fetchServiceAccountDeleteMutation,
});
