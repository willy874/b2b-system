import { fetchRemoveTenantDomainMutation } from './fetcher';

export const getRemoveTenantDomainMutationOptions = () => ({
  mutationFn: fetchRemoveTenantDomainMutation,
});
