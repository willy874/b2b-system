import { useQuery } from '@tanstack/react-query';

import { getPublicSettingsQueryOptions } from '@/apis/auth/get-public-settings/query';

/** 後端 `PasswordSchema` 的下限；平台管理者與「租戶設定還沒載入」時都用它。 */
export const BASE_PASSWORD_MIN_LENGTH = 12;

export interface AccountPolicy {
  passwordMinLength: number;
  registrationEnabled: boolean;
  /** 租戶設定載入中：註冊入口先不顯示，免得出現後又消失。 */
  isLoading: boolean;
}

/**
 * 帳號流程要遵守的租戶設定（`GET /system/settings/public`，docs/architecture/backend/12-settings.md §3）。
 * 沒有租戶是平台管理者：沒有註冊、密碼長度用基準值。讀不到設定時退回基準值，後端仍會再檢查一次。
 */
export function useAccountPolicy(tenant: string | undefined): AccountPolicy {
  const { data, isPending } = useQuery({
    ...getPublicSettingsQueryOptions(tenant ?? ''),
    enabled: Boolean(tenant),
  });
  if (!tenant) {
    return {
      passwordMinLength: BASE_PASSWORD_MIN_LENGTH,
      registrationEnabled: false,
      isLoading: false,
    };
  }
  const minLength = data?.values['auth.passwordMinLength'];
  const registration = data?.values['auth.registrationEnabled'];
  return {
    passwordMinLength: typeof minLength === 'number' ? minLength : BASE_PASSWORD_MIN_LENGTH,
    registrationEnabled: typeof registration === 'boolean' ? registration : true,
    isLoading: isPending,
  };
}
