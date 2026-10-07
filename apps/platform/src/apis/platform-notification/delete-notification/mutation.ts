import { fetchDeleteNotificationMutation } from './fetcher';

export const getDeleteNotificationMutationOptions = () => ({
  mutationFn: fetchDeleteNotificationMutation,
});
