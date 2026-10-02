import { useStore } from '@/shared/hooks';

import { featureStore } from './store';

/**
 * 某個 feature flag 目前是否生效為開（docs/architecture/05-tenancy.md §11.2 D9）：給 feature 內的局部 UI 在渲染時判斷，
 * 不影響註冊。平台管理者變更時 profile 重新取得，這裡跟著更新。整個 feature 的試行改用 catalog 的 `requires.flag`。
 *
 * 前端的隱藏只是體驗：對應的端點要標 `@RequireFlag`，由 api 擋。
 */
export function useFlag(key: string): boolean {
  return useStore(featureStore, (state) => state.flags.has(key));
}
