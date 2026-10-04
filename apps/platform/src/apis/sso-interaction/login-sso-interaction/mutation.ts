import { fetchLoginSsoInteractionMutation } from './fetcher';

export const getLoginSsoInteractionMutationOptions = () => ({
  mutationFn: fetchLoginSsoInteractionMutation,
});
