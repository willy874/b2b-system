import { fetchPurgeCdnMutation } from './fetcher';

export const getPurgeCdnMutationOptions = () => ({
  mutationFn: fetchPurgeCdnMutation,
});
