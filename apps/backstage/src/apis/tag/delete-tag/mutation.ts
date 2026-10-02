import { fetchTagDeleteMutation } from './fetcher';

export const getTagDeleteMutationOptions = () => ({
  mutationFn: fetchTagDeleteMutation,
});
