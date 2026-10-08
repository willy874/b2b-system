import { useErrorToast } from '@b2b-system/web-core/errors';
import { useMutation, useQuery } from '@tanstack/react-query';

import type { CommentTargetParams } from '@/apis/comment/types';
import { invalidateResources, Resource } from '@/apis/resources';
import { getWatchStateQueryOptions } from '@/apis/watch/get-watch-state/query';
import { getUnwatchMutationOptions } from '@/apis/watch/unwatch-resource/mutation';
import { getWatchMutationOptions } from '@/apis/watch/watch-resource/mutation';

/** 自己對這個資源的關注與切換（docs/architecture/backend/24-comment.md §3.2）。 */
export function useWatch(target: CommentTargetParams) {
  const showError = useErrorToast();
  const state = useQuery(getWatchStateQueryOptions(target));
  const onSuccess = () =>
    invalidateResources([{ resource: Resource.WATCH, kind: 'update', id: target.resourceId }]);
  const watch = useMutation({ ...getWatchMutationOptions(), onSuccess, onError: showError });
  const unwatch = useMutation({ ...getUnwatchMutationOptions(), onSuccess, onError: showError });

  const toggle = () => {
    const mutation = state.data?.watching ? unwatch : watch;
    mutation.mutate({ params: target });
  };
  return { state, toggle, pending: watch.isPending || unwatch.isPending };
}
