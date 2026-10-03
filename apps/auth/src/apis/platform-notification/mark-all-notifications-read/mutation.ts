import { fetchMarkAllNotificationsReadMutation } from './fetcher';

export const getMarkAllNotificationsReadMutationOptions = () => ({
  mutationFn: fetchMarkAllNotificationsReadMutation,
});
