import { fetchRetryPlatformJobMutation } from './fetcher';

export const getRetryPlatformJobMutationOptions = () => ({
  mutationFn: fetchRetryPlatformJobMutation,
});
