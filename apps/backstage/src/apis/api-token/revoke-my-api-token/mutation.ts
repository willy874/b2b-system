import { fetchMyApiTokenRevokeMutation } from './fetcher';

export const getMyApiTokenRevokeMutationOptions = () => ({
  mutationFn: fetchMyApiTokenRevokeMutation,
});
