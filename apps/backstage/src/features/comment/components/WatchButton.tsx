import { Button } from '@b2b-system/ui/Button';
import { Icon } from '@b2b-system/ui/Icon';
import { useTranslation } from '@b2b-system/web-core/locales';

import type { CommentTargetParams } from '@/apis/comment/types';

import { useWatch } from '../hooks/useWatch';

/** 關注／取消關注：有新留言或資源被修改時收到通知（docs/architecture/backend/24-comment.md §4）。 */
export function WatchButton({ target }: { target: CommentTargetParams }) {
  const { t } = useTranslation();
  const { state, toggle, pending } = useWatch(target);
  if (!state.data) return null;
  const { watching, watcherCount } = state.data;
  return (
    <Button
      size="sm"
      variant={watching ? 'secondary' : 'ghost'}
      startIcon={<Icon name="bell" size={14} />}
      onClick={toggle}
      loading={pending}
      aria-pressed={watching}
      title={t('comment.watch.count', { count: watcherCount })}
      data-testid="comment-watch-button"
      data-value={watching ? 'watching' : 'idle'}
    >
      {watching ? t('comment.watch.watching') : t('comment.watch.action')}
    </Button>
  );
}
