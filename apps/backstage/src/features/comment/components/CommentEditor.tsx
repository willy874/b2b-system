import { Button } from '@b2b-system/ui/Button';
import { FormError } from '@b2b-system/ui/FormError';
import { Textarea } from '@b2b-system/ui/Input';
import { Select } from '@b2b-system/ui/Select';
import type { SelectOption } from '@b2b-system/ui/Select';
import { isAppError, useErrorMessage } from '@b2b-system/web-core/errors';
import { useTranslation } from '@b2b-system/web-core/locales';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';

import type { CommentTargetParams } from '@/apis/comment/types';
import type { CommentUser } from '@/shared/api-sdk';

import { useMentionableUsers } from '../hooks/useMentionableUsers';

/** 與後端的上限相同（docs/architecture/backend/24-comment.md §8.2 D11）：超過時送出鈕停用，不必等 400。 */
const BODY_MAX_LENGTH = 4000;
const MAX_MENTIONS = 20;

export interface CommentEditorInput {
  body: string;
  mentionIds: string[];
}

interface CommentEditorProps {
  target: CommentTargetParams;
  /** 編輯時的原文與被提及的人；新增時不傳。 */
  initialBody?: string;
  initialMentions?: readonly CommentUser[];
  submitLabel: string;
  /** 成功後新增模式清空內容；失敗時訊息顯示在編輯器裡、內容保留。 */
  onSubmit: (input: CommentEditorInput) => Promise<unknown>;
  onCancel?: () => void;
  /** 掛上時把焦點移到內文（使用者按了「編輯」之後）；新增的編輯器不搶焦點。 */
  focusOnMount?: boolean;
  'data-testid'?: string;
}

function toOption(user: CommentUser): SelectOption {
  return {
    value: user.id,
    label: user.displayName,
    textValue: `${user.displayName} ${user.email}`,
    description: user.email,
  };
}

/**
 * 留言的編輯器：純文字 ＋「提及」的人（docs/architecture/backend/24-comment.md §8.2 D6）。被提及的人從後端的候選挑選
 * （只會出現看得到這個資源的人），內文裡不需要打 `@`。⌘／Ctrl + Enter 送出。
 */
export function CommentEditor({
  target,
  initialBody = '',
  initialMentions = [],
  submitLabel,
  onSubmit,
  onCancel,
  focusOnMount,
  'data-testid': testId = 'comment-editor',
}: CommentEditorProps) {
  const { t } = useTranslation();
  const toMessage = useErrorMessage();
  const [body, setBody] = useState(initialBody);
  const [mentions, setMentions] = useState<readonly CommentUser[]>(initialMentions);
  const [keyword, setKeyword] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<unknown>();
  const candidates = useMentionableUsers(target, keyword, pickerOpen);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (focusOnMount) bodyRef.current?.focus();
  }, [focusOnMount]);

  // 已選的人不一定在這一批候選裡：合併進選項，觸發鈕上的名稱才不會消失
  const known = useMemo(() => {
    const users = new Map(mentions.map((user) => [user.id, user]));
    for (const user of candidates.data?.items ?? []) users.set(user.id, user);
    return users;
  }, [candidates.data, mentions]);
  const options = useMemo(() => [...known.values()].map(toOption), [known]);

  const trimmed = body.trim();
  const canSubmit = trimmed.length > 0 && body.length <= BODY_MAX_LENGTH && !submitting;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(undefined);
    try {
      await onSubmit({ body: trimmed, mentionIds: mentions.map((user) => user.id) });
      if (!initialBody) {
        setBody('');
        setMentions([]);
      }
    } catch (caught) {
      setError(caught);
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    void submit();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void submit();
    }
  };

  return (
    <form className="flex flex-col gap-2" onSubmit={handleSubmit} data-testid={testId}>
      <Textarea
        ref={bodyRef}
        value={body}
        onChange={(event) => setBody(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={t('comment.editor.placeholder')}
        aria-label={t('comment.editor.label')}
        maxLength={BODY_MAX_LENGTH}
        rows={3}
        data-testid="comment-editor-body"
      />
      <div className="flex flex-wrap items-center gap-2">
        <Select
          multiple
          size="sm"
          className="min-w-48 flex-1"
          options={options}
          value={mentions.map((user) => user.id)}
          onValueChange={(ids) =>
            setMentions(
              ids.slice(0, MAX_MENTIONS).flatMap((id) => {
                const user = known.get(id);
                return user ? [user] : [];
              }),
            )
          }
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          searchable
          filterOption={false}
          onSearchChange={setKeyword}
          loading={candidates.isFetching}
          placeholder={t('comment.editor.mentionPlaceholder')}
          searchPlaceholder={t('comment.editor.mentionSearch')}
          noMatchLabel={t('comment.editor.mentionEmpty')}
          emptyLabel={t('comment.editor.mentionEmpty')}
          aria-label={t('comment.editor.mentionLabel')}
          data-testid="comment-editor-mentions"
        />
        {onCancel && (
          <Button size="sm" onClick={onCancel} data-testid="comment-editor-cancel">
            {t('common.cancel')}
          </Button>
        )}
        <Button
          size="sm"
          variant="primary"
          type="submit"
          disabled={!canSubmit}
          loading={submitting}
          data-testid="comment-editor-submit"
        >
          {submitLabel}
        </Button>
      </div>
      <FormError code={isAppError(error) ? error.code : undefined}>
        {error !== undefined ? toMessage(error) : undefined}
      </FormError>
    </form>
  );
}
