import { Button } from '@b2b-system/ui/Button';
import { Skeleton } from '@b2b-system/ui/Skeleton';
import { QueryError } from '@b2b-system/web-core/components';
import { useTranslation } from '@b2b-system/web-core/locales';

import type { CommentTargetParams } from '@/apis/comment/types';
import type { ResourcePanelProps } from '@/core/resource-panel';

import { isCommentable } from '../constants';
import { useCommentCreateMutation } from '../hooks/useCommentMutations';
import { useComments } from '../hooks/useComments';
import { CommentEditor } from './CommentEditor';
import { CommentItem } from './CommentItem';
import { WatchButton } from './WatchButton';

/**
 * 資源頁上的「留言」面板（docs/architecture/frontend/22-comment.md §3）：關注、新增、列表（新的在前、往下載入較舊的）。
 * 看得到資源就能留言；看不到時後端回 403／404，面板只顯示錯誤。
 */
export function CommentPanel({ resourceType, resourceId }: ResourcePanelProps) {
  if (!isCommentable(resourceType)) return null;
  return <CommentPanelContent target={{ resourceType, resourceId }} />;
}

function CommentPanelContent({ target }: { target: CommentTargetParams }) {
  const { t } = useTranslation();
  const { query, comments } = useComments(target);
  const create = useCommentCreateMutation();

  return (
    <section data-testid="comment-panel">
      <div className="flex items-center justify-between">
        <h3 className="m-0 text-sm font-semibold">{t('comment.title')}</h3>
        <WatchButton target={target} />
      </div>
      <div className="mt-2">
        <CommentEditor
          target={target}
          submitLabel={t('comment.editor.submit')}
          onSubmit={(input) => create.mutateAsync({ params: { ...target, ...input } })}
        />
      </div>
      <div className="mt-4 flex flex-col gap-4" data-testid="comment-list">
        {query.isPending && <Skeleton height={60} />}
        {query.isError && (
          <QueryError
            error={query.error}
            onRetry={() => void query.refetch()}
            data-testid="comment-error"
          />
        )}
        {query.isSuccess && comments.length === 0 && (
          <p className="m-0 text-sm text-[var(--color-fg-muted)]" data-testid="comment-empty">
            {t('comment.empty')}
          </p>
        )}
        {comments.map((comment) => (
          <CommentItem key={comment.id} comment={comment} target={target} />
        ))}
        {query.hasNextPage && (
          <Button
            size="sm"
            variant="ghost"
            className="self-start"
            onClick={() => void query.fetchNextPage()}
            loading={query.isFetchingNextPage}
            data-testid="comment-load-more"
          >
            {t('comment.loadMore')}
          </Button>
        )}
      </div>
    </section>
  );
}
