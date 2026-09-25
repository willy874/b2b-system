import { useMutation } from '@tanstack/react-query';

import { getRegisterMutationOptions } from '@/apis/auth/register/mutation';

/**
 * 送出註冊申請。未登入的使用者看不到審批列表，所以不失效任何 query；
 * 管理員那端靠推播（`approval.create`）更新。
 */
export function useRegisterMutation() {
  return useMutation(getRegisterMutationOptions());
}
