import { fetchAnnouncementCreateMutation } from './fetcher';

export const getAnnouncementCreateMutationOptions = () => ({
  mutationFn: fetchAnnouncementCreateMutation,
});
