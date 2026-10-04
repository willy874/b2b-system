import { fetchUpdateFeatureFlagMutation } from './fetcher';

export const getUpdateFeatureFlagMutationOptions = () => ({
  mutationFn: fetchUpdateFeatureFlagMutation,
});
