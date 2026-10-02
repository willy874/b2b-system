import { fetchWebhookRedeliverMutation } from './fetcher';

export const getWebhookRedeliverMutationOptions = () => ({
  mutationFn: fetchWebhookRedeliverMutation,
});
