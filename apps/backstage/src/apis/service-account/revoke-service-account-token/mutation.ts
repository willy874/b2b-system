import { fetchServiceAccountTokenRevokeMutation } from './fetcher';

export const getServiceAccountTokenRevokeMutationOptions = () => ({
  mutationFn: fetchServiceAccountTokenRevokeMutation,
});
