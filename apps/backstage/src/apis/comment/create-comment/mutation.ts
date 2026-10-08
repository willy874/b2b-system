import { fetchCommentCreateMutation } from './fetcher';

export const getCommentCreateMutationOptions = () => ({
  mutationFn: fetchCommentCreateMutation,
});
