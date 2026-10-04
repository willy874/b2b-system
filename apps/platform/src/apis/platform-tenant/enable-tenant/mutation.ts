import { fetchEnableTenantMutation } from './fetcher';

export const getEnableTenantMutationOptions = () => ({
  mutationFn: fetchEnableTenantMutation,
});
