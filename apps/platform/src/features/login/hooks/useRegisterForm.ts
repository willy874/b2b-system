import { useErrorMessage } from '@b2b-system/web-core/errors';
import { zodFormValidator } from '@b2b-system/web-shared/hooks';
import { useForm } from '@tanstack/react-form';
import { useMemo, useState } from 'react';
import { z } from 'zod';

import { useAccountPolicy } from './useAccountPolicy';
import { useRegisterMutation } from './useRegisterMutation';

/** 密碼長度是租戶的設定（`auth.passwordMinLength`）。 */
function createSchema(passwordMinLength: number) {
  return z
    .object({
      email: z.string().trim().min(1).email(),
      displayName: z.string().trim().min(1).max(100),
      password: z.string().min(passwordMinLength),
      confirmPassword: z.string().min(1),
      reason: z.string().trim().max(500),
    })
    .refine((value) => value.password === value.confirmPassword, {
      path: ['confirmPassword'],
      params: { messageKey: 'validation.passwordMismatch' },
    });
}

/**
 * 註冊申請的流程（docs/rbac/06-approval.md §5）：租戶的註冊政策（是否開放、密碼長度）、表單驗證與送出。
 * 不論 email 是否已存在，後端都回同樣的結果（帳號列舉防護），送出後一律是 `submitted`。
 */
export function useRegisterForm(tenant: string | undefined) {
  const register = useRegisterMutation();
  const toMessage = useErrorMessage();
  const [submitted, setSubmitted] = useState(false);
  const [formError, setFormError] = useState<string>();
  const policy = useAccountPolicy(tenant);
  const schema = useMemo(() => createSchema(policy.passwordMinLength), [policy.passwordMinLength]);

  const form = useForm({
    defaultValues: { email: '', displayName: '', password: '', confirmPassword: '', reason: '' },
    validators: { onSubmit: zodFormValidator(schema) },
    onSubmit: async ({ value }) => {
      setFormError(undefined);
      try {
        await register.mutateAsync({
          params: {
            tenant: tenant ?? '',
            email: value.email,
            displayName: value.displayName,
            password: value.password,
            reason: value.reason.trim() || undefined,
          },
        });
        setSubmitted(true);
      } catch (error) {
        // 弱密碼（VALIDATION_FAILED）、限流（RATE_LIMITED）
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
