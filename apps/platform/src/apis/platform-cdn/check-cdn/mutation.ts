import { fetchCheckCdnMutation } from './fetcher';

export const getCheckCdnMutationOptions = () => ({
  mutationFn: fetchCheckCdnMutation,
});
