import { fetchUserResetPasswordMutation } from './fetcher';

export const getUserResetPasswordMutationOptions = () => ({
  mutationFn: fetchUserResetPasswordMutation,
});
