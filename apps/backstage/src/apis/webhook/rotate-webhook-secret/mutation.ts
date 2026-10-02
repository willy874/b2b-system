import { fetchWebhookSecretRotateMutation } from './fetcher';

export const getWebhookSecretRotateMutationOptions = () => ({
  mutationFn: fetchWebhookSecretRotateMutation,
});
