import { fetchRetryTenantProvisioningMutation } from './fetcher';

export const getRetryTenantProvisioningMutationOptions = () => ({
  mutationFn: fetchRetryTenantProvisioningMutation,
});
