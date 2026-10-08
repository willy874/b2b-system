import { fetchCommentUpdateMutation } from './fetcher';

export const getCommentUpdateMutationOptions = () => ({
  mutationFn: fetchCommentUpdateMutation,
});
