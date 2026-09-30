import { fetchRetryJobMutation } from './fetcher';

export const getRetryJobMutationOptions = () => ({
  mutationFn: fetchRetryJobMutation,
});
