import { useErrorMessage, useServerFieldErrors } from '@b2b-system/web-core/errors';
import { useUnsavedChangesGuard } from '@b2b-system/web-core/router';
import { zodFormValidator } from '@b2b-system/web-shared/hooks';
import { useForm, useStore } from '@tanstack/react-form';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { z } from 'zod';

import { getRoleOptionsQueryOptions } from '@/apis/role/get-role-list/query';

import { UserCreateRoute, UserListRoute } from '../routes';
import { useUserCreateMutation } from './useUserMutations';
import { useUserPermission } from './useUserPermission';

const Schema = z.object({
  email: z.string().trim().email().max(255),
  displayName: z.string().trim().min(1).max(100),
  // 選填：空字串或 3–50 字元。不用 union（錯誤訊息只會是「輸入的值不正確」）
  username: z
    .string()
    .trim()
    .max(50)
    .refine((value) => value === '' || value.length >= 3, {
      params: { messageKey: 'validation.usernameTooShort' },
    }),
});

const FIELDS = ['email', 'displayName', 'username', 'roleIds'] as const;

/**
 * 新增使用者對話框的流程：表單驗證、角色選項（有 `role:read` 才查）、送出、
 * 後端的欄位錯誤回填（Email／使用者名稱重複）、未儲存提醒，以及關閉（回到列表、保留列表的條件）。
 */
export function useUserCreateForm() {
  const navigate = useNavigate();
  const search = UserCreateRoute.useSearch();
  const permission = useUserPermission();
  const createUser = useUserCreateMutation();
  const toMessage = useErrorMessage();
  const [roleIds, setRoleIds] = useState<string[]>([]);
  const [formError, setFormError] = useState<string>();
  // Email／使用者名稱重複、後端欄位驗證失敗 → 顯示在該欄位下方並聚焦
  const serverErrors = useServerFieldErrors(FIELDS, {
    USER_EMAIL_DUPLICATE: 'email',
    USER_USERNAME_DUPLICATE: 'username',
  });
  const { report: reportServerError, reset: resetServerErrors } = serverErrors;

  const roles = useQuery({ ...getRoleOptionsQueryOptions(), enabled: permission.canReadRoles });
  const close = (options?: { ignoreBlocker?: boolean }) =>
    void navigate({ to: UserListRoute.to, search, ...options });

  const form = useForm({
    defaultValues: { email: '', displayName: '', username: '' },
    validators: { onSubmit: zodFormValidator(Schema) },
    onSubmit: async ({ value }) => {
      setFormError(undefined);
      resetServerErrors();
      try {
        await createUser.mutateAsync({
          params: {
            email: value.email,
            displayName: value.displayName,
            username: value.username || undefined,
            roleIds,
          },
        });
      } catch (error) {
        if (!reportServerError(error)) setFormError(toMessage(error));
        return;
      }
      close({ ignoreBlocker: true });
    },
  });
  const isFormDirty = useStore(form.store, (state) => state.isDirty);
  useUnsavedChangesGuard(isFormDirty || roleIds.length > 0);

  return {
    form,
    /** 有 `user:assignRole` 才顯示角色欄 */
    canAssignRole: permission.canAssignRole,
    roleOptions: roles.data?.items,
    roleIds,
    setRoleIds: (next: string[]) => {
      serverErrors.clear('roleIds');
      setRoleIds(next);
    },
    serverErrors: serverErrors.errors,
    clearServerError: serverErrors.clear,
    /** 掛在 `<form ref>`：後端回欄位錯誤時聚焦第一個錯的欄位 */
    formRef: serverErrors.formRef,
    formError,
    submitting: createUser.isPending,
    close,
  };
}
