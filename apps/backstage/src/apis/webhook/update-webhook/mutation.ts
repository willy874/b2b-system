import { fetchWebhookUpdateMutation } from './fetcher';

export const getWebhookUpdateMutationOptions = () => ({
  mutationFn: fetchWebhookUpdateMutation,
});
