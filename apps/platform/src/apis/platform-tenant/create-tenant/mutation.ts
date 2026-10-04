import { fetchCreateTenantMutation } from './fetcher';

export const getCreateTenantMutationOptions = () => ({
  mutationFn: fetchCreateTenantMutation,
});
