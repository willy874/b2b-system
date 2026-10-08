import { fetchUnwatchMutation } from './fetcher';

export const getUnwatchMutationOptions = () => ({
  mutationFn: fetchUnwatchMutation,
});
