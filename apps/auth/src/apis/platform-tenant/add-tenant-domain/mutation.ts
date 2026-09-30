import { fetchAddTenantDomainMutation } from './fetcher';

export const getAddTenantDomainMutationOptions = () => ({
  mutationFn: fetchAddTenantDomainMutation,
});
