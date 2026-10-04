import { fetchDeleteTenantMutation } from './fetcher';

export const getDeleteTenantMutationOptions = () => ({
  mutationFn: fetchDeleteTenantMutation,
});
