import { fetchTagUpdateMutation } from './fetcher';

export const getTagUpdateMutationOptions = () => ({
  mutationFn: fetchTagUpdateMutation,
});
