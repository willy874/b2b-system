import { fetchForgotPasswordMutation } from './fetcher';

export const getForgotPasswordMutationOptions = () => ({
  mutationFn: fetchForgotPasswordMutation,
});
