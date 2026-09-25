import { Field } from '@/components/Field';
import { Textarea } from '@/components/Input';
import { Select } from '@/components/Select';
import { useTranslation } from '@/core/locales';
import type { Role } from '@/shared/api-sdk';

import type { ApprovalDetailVM } from '../adapter';
import type { ApprovalReviewState } from '../useApprovalReview';
import { useApprovalReviewAccess } from '../useApprovalReviewAccess';

interface ApprovalReviewFormProps {
  approval: ApprovalDetailVM;
  review: ApprovalReviewState;
  /** 核准註冊時可指派的角色（需要 role:read） */
  roleOptions: Role[] | undefined;
}

/** 審核欄位：指派角色、審核意見。按鈕在對話框 footer（`ApprovalReviewActions`）。 */
export function ApprovalReviewForm({ approval, review, roleOptions }: ApprovalReviewFormProps) {
  const { t } = useTranslation();
  const access = useApprovalReviewAccess(approval);

  if (!access.visible) return null;

  return (
    <section className="flex flex-col gap-4" data-testid="approval-review-form">
      <h3 className="m-0 text-sm font-semibold">{t('approval.review.title')}</h3>

      {access.canAssignRole && (
        <Field label={t('approval.review.roles')}>
          <Select
            multiple
            searchable
            valueOrder="options"
            value={review.roleIds}
            onValueChange={review.setRoleIds}
            options={(roleOptions ?? []).map((role) => ({
              value: role.id,
              label: role.name,
              textValue: `${role.name} ${role.slug}`,
              description: role.slug,
            }))}
            itemSize={48}
            placeholder={t('approval.review.rolesPlaceholder')}
            searchPlaceholder={t('common.search')}
            data-testid="approval-role-select"
          />
        </Field>
      )}

      <Field label={t('approval.field.comment')}>
        <Textarea
          rows={3}
          maxLength={500}
          value={review.comment}
          onChange={(event) => review.setComment(event.target.value)}
          placeholder={t('approval.review.commentPlaceholder')}
          data-testid="approval-comment-input"
        />
      </Field>

      {!access.canApprove && (
        <p className="m-0 text-xs text-[var(--color-fg-muted)]" data-testid="approval-approve-hint">
          {t('approval.review.missingCreatePermission')}
        </p>
      )}
      {review.error && (
        <p className="m-0 text-sm text-[var(--color-danger-text)]" data-testid="approval-error">
          {review.error}
        </p>
      )}
    </section>
  );
}
