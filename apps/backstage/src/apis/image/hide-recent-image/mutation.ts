import { fetchHideRecentImageMutation } from './fetcher';

/** 從最近使用移除（不影響正在使用它的地方）。 */
export const getHideRecentImageMutationOptions = () => ({
  mutationFn: fetchHideRecentImageMutation,
});
