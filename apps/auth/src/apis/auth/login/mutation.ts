import { fetchLoginMutation } from './fetcher';

export const getLoginMutationOptions = () => ({ mutationFn: fetchLoginMutation });
