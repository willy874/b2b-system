import { fetchLogoutMutation } from './fetcher';

export const getLogoutMutationOptions = () => ({ mutationFn: fetchLogoutMutation });
