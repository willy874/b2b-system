import { fetchResendMfaChallengeMutation } from './fetcher';

export const getResendMfaChallengeMutationOptions = () => ({
  mutationFn: fetchResendMfaChallengeMutation,
});
