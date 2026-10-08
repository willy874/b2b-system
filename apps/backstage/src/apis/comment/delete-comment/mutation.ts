import { fetchCommentDeleteMutation } from './fetcher';

export const getCommentDeleteMutationOptions = () => ({
  mutationFn: fetchCommentDeleteMutation,
});
