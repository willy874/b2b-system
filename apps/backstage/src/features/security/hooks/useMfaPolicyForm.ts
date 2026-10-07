import { useConfirm } from '@b2b-system/ui/ConfirmDialog';
import { isAppError, useErrorMessage } from '@b2b-system/web-core/errors';
import { useTranslation } from '@b2b-system/web-core/locales';
import { useToast } from '@b2b-system/web-core/notify';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import {
  getMfaPolicyQueryOptions,
  MFA_POLICY_QUERY_KEY,
} from '@/apis/mfa-policy/get-mfa-policy/query';
import { getPreviewMfaPolicyMutationOptions } from '@/apis/mfa-policy/preview-mfa-policy/mutation';
import { getUpdateMfaPolicyMutationOptions } from '@/apis/mfa-policy/update-mfa-policy/mutation';
import type { MfaPolicy, UpdateMfaPolicyRequest } from '@/shared/api-sdk';

type Draft = Pick<UpdateMfaPolicyRequest, 'requireAll' | 'requiredRoleIds' | 'allowedMethods'>;

function draftOf(policy: MfaPolicy): Draft {
  return {
    requireAll: policy.requireAll,
    requiredRoleIds: policy.requiredRoleIds,
    allowedMethods: policy.allowedMethods,
  };
}

function sameDraft(a: Draft, b: Draft): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * MFA 政策的表單（docs/architecture/backend/21-mfa.md §6）：草稿留在頁面；儲存前先預覽影響，
 * 會讓人被擋在門外或新增不符合政策的人時先確認。版本衝突時重新載入。
 */
export function useMfaPolicyForm() {
  const { t } = useTranslation();
  const toast = useToast();
  const confirm = useConfirm();
  const toMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const policy = useQuery(getMfaPolicyQueryOptions());
  const preview = useMutation(getPreviewMfaPolicyMutationOptions());
  const update = useMutation(getUpdateMfaPolicyMutationOptions());
  const [draft, setDraft] = useState<Draft>();
  const [error, setError] = useState<{ message: string; code?: string }>();

  const current = draft ?? (policy.data && draftOf(policy.data));
  const dirty = Boolean(draft && policy.data && !sameDraft(draft, draftOf(policy.data)));

  const change = (patch: Partial<Draft>) => {
    if (!current) return;
    setError(undefined);
    setDraft({ ...current, ...patch });
  };

  const save = async () => {
    if (!current || !policy.data) return;
    setError(undefined);
    const request = { ...current, version: policy.data.version };
    try {
      const impact = await preview.mutateAsync({ params: request });
      if (impact.stranded > 0 || impact.nonCompliant > policy.data.nonCompliant) {
        const ok = await confirm({
          title: t('security.mfa.confirmTitle'),
          description: [
            impact.nonCompliant > 0
              ? t('security.mfa.confirmNonCompliant', { count: impact.nonCompliant })
              : '',
            impact.stranded > 0
              ? t('security.mfa.confirmStranded', { count: impact.stranded })
              : '',
          ]
            .filter(Boolean)
            .join('\n'),
          confirmLabel: t('common.save'),
          tone: 'danger',
          'data-testid': 'security-mfa-confirm',
        });
        if (!ok) return;
      }
      const saved = await update.mutateAsync({ params: request });
      queryClient.setQueryData([MFA_POLICY_QUERY_KEY], saved);
      setDraft(undefined);
      toast.success(t('security.mfa.saved'));
    } catch (cause) {
      if (isAppError(cause) && cause.code === 'MFA_POLICY_VERSION_CONFLICT') {
        setDraft(undefined);
        void policy.refetch();
      }
      setError({ message: toMessage(cause), code: isAppError(cause) ? cause.code : undefined });
    }
  };

  return {
    policy,
    current,
    dirty,
    change,
    save,
    reset: () => setDraft(undefined),
    saving: preview.isPending || update.isPending,
    error,
  };
}
