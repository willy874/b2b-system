import { Button } from '@b2b-system/ui/Button';
import { Icon } from '@b2b-system/ui/Icon';
import { useErrorMessage } from '@b2b-system/web-core/errors';
import { useTranslation } from '@b2b-system/web-core/locales';

import type { CommentTargetParams } from '@/apis/comment/types';

import { useWatch } from '../hooks/useWatch';

/** 關注／取消關注：有新留言或資源被修改時收到通知（docs/architecture/backend/24-comment.md §4）。 */
export function WatchButton({ target }: { target: CommentTargetParams }) {
  const { t } = useTranslation();
  const toMessage = useErrorMessage();
  const { state, toggle, pending } = useWatch(target);
  if (!state.data) {
    // 載入中停用、失敗時按了重試；按鈕不消失，使用者才知道是出錯而不是不能關注（docs/architecture/frontend/07-ui-system.md §6.1）
    const label = state.isError
      ? t('comment.watch.loadFailed', { message: toMessage(state.error) })
      : undefined;
    return (
      <Button
        size="sm"
        variant="ghost"
        startIcon={<Icon name="bell" size={14} />}
        disabled={!state.isError}
        onClick={() => void state.refetch()}
        title={label}
        aria-label={label}
        data-testid="comment-watch-button"
        data-value={state.isError ? 'error' : 'loading'}
      >
        {t('comment.watch.action')}
      </Button>
    );
  }
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
