import { Avatar } from '@b2b-system/ui/Avatar';
import { IconButton } from '@b2b-system/ui/Button';
import { Chip } from '@b2b-system/ui/Chip';
import { useConfirm } from '@b2b-system/ui/ConfirmDialog';
import { Icon } from '@b2b-system/ui/Icon';
import { Menu } from '@b2b-system/ui/Menu';
import type { MenuItemDescriptor } from '@b2b-system/ui/Menu';
import { useTranslation } from '@b2b-system/web-core/locales';
import { formatDateTime, formatRelativeTime } from '@b2b-system/web-shared/date';
import { useState } from 'react';

import type { CommentTargetParams } from '@/apis/comment/types';
import type { Comment } from '@/shared/api-sdk';

import { useCommentDeleteMutation, useCommentUpdateMutation } from '../hooks/useCommentMutations';
import { CommentEditor } from './CommentEditor';

interface CommentItemProps {
  comment: Comment;
  target: CommentTargetParams;
}

/** 一則留言：作者、時間、內文、被提及的人；作者能編輯、作者或管理者能刪除（後端算好的 `canEdit`／`canDelete`）。 */
export function CommentItem({ comment, target }: CommentItemProps) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const [editing, setEditing] = useState(false);
  const update = useCommentUpdateMutation();
  const remove = useCommentDeleteMutation();
  const authorName = comment.author?.displayName ?? t('comment.deletedUser');

  const actions: MenuItemDescriptor[] = [];
  if (comment.canEdit) {
    actions.push({ key: 'edit', label: t('common.edit'), onSelect: () => setEditing(true) });
  }
  if (comment.canDelete) {
    actions.push({
      key: 'delete',
      label: t('common.delete'),
      tone: 'danger',
      onSelect: () =>
        void confirm({
          title: t('comment.delete.title'),
          description: t('comment.delete.confirm'),
          confirmLabel: t('common.delete'),
          tone: 'danger',
          onConfirm: () => remove.mutateAsync({ params: { commentId: comment.id } }),
          'data-testid': 'comment-delete-confirm',
        }),
    });
  }

  return (
    <article className="flex gap-3" data-testid="comment-item" data-value={comment.id}>
      <Avatar name={authorName} size={28} />
      <div className="min-w-0 flex-1">
        <header className="flex items-center gap-2">
          <span className="text-sm font-medium">{authorName}</span>
          <time
            className="text-xs text-[var(--color-fg-muted)]"
            dateTime={comment.createdAt}
            title={formatDateTime(comment.createdAt)}
          >
            {formatRelativeTime(comment.createdAt)}
          </time>
          {comment.editedAt && (
            <span
              className="text-xs text-[var(--color-fg-muted)]"
              title={formatDateTime(comment.editedAt)}
              data-testid="comment-edited"
            >
              {t('comment.edited')}
            </span>
          )}
          {actions.length > 0 && !editing && (
            <Menu
              align="end"
              trigger={
                <IconButton
                  size="sm"
                  className="ml-auto"
                  aria-label={t('comment.actions')}
                  data-testid="comment-actions"
                >
                  <Icon name="more" size={16} />
                </IconButton>
              }
              items={actions}
            />
          )}
        </header>
        {editing ? (
          <div className="mt-1">
            <CommentEditor
              target={target}
              initialBody={comment.body}
              initialMentions={comment.mentions}
              submitLabel={t('common.save')}
              focusOnMount
              onCancel={() => setEditing(false)}
              onSubmit={async (input) => {
                await update.mutateAsync({
                  params: { commentId: comment.id, ...input, version: comment.version },
                });
                setEditing(false);
              }}
              data-testid="comment-edit-editor"
            />
          </div>
        ) : (
          <>
            <p
              className="m-0 mt-1 whitespace-pre-wrap break-words text-sm"
              data-testid="comment-body"
            >
              {comment.body}
            </p>
            {comment.mentions.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1" data-testid="comment-mentions">
                {comment.mentions.map((user) => (
                  <Chip key={user.id} tone="brand">
                    @{user.displayName}
                  </Chip>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </article>
  );
}
