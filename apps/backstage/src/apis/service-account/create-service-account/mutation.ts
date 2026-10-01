import { fetchServiceAccountCreateMutation } from './fetcher';

export const getServiceAccountCreateMutationOptions = () => ({
  mutationFn: fetchServiceAccountCreateMutation,
});
