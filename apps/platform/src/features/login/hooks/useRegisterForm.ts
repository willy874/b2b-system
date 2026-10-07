import { useErrorMessage } from '@b2b-system/web-core/errors';
import { zodFormValidator } from '@b2b-system/web-shared/hooks';
import { useForm } from '@tanstack/react-form';
import { useState } from 'react';
import { z } from 'zod';

import { useAccountPolicy } from './useAccountPolicy';
import { useRegisterMutation } from './useRegisterMutation';

const RegisterFormSchema = z.object({
  email: z.string().trim().min(1).email(),
  displayName: z.string().trim().min(1).max(100),
  reason: z.string().trim().max(500),
});

/**
 * 註冊申請的流程（docs/rbac/06-approval.md §5）：租戶的註冊政策（是否開放）、表單驗證與送出。
 * 不填密碼：核准後由寄到這個 email 的啟用信設定（同時證明擁有這個信箱）。
 * 不論 email 是否已存在，後端都回同樣的結果（帳號列舉防護），送出後一律是 `submitted`。
 */
export function useRegisterForm(tenant: string | undefined) {
  const register = useRegisterMutation();
  const toMessage = useErrorMessage();
  const [submitted, setSubmitted] = useState(false);
  const [formError, setFormError] = useState<string>();
  const policy = useAccountPolicy(tenant);

  const form = useForm({
    defaultValues: { email: '', displayName: '', reason: '' },
    validators: { onSubmit: zodFormValidator(RegisterFormSchema) },
    onSubmit: async ({ value }) => {
      setFormError(undefined);
      try {
        await register.mutateAsync({
          params: {
            tenant: tenant ?? '',
            email: value.email,
            displayName: value.displayName,
            reason: value.reason.trim() || undefined,
          },
        });
        setSubmitted(true);
      } catch (error) {
        // 限流（RATE_LIMITED）、只允許 SSO 的網域（AUTH_SSO_REQUIRED）
        setFormError(toMessage(error));
      }
    },
  });

  return {
    form,
    policy,
    /** 租戶關閉了註冊（載入中不算，免得先顯示「已關閉」再變成表單） */
    closed: !policy.isLoading && !policy.registrationEnabled,
    submitted,
    submitting: register.isPending,
    formError,
  };
}
