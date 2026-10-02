import { fetchWebhookDeleteMutation } from './fetcher';

export const getWebhookDeleteMutationOptions = () => ({
  mutationFn: fetchWebhookDeleteMutation,
});
