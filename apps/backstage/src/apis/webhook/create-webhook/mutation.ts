import { fetchWebhookCreateMutation } from './fetcher';

export const getWebhookCreateMutationOptions = () => ({
  mutationFn: fetchWebhookCreateMutation,
});
