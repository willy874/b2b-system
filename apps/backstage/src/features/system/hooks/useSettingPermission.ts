import { usePagePermission } from '@/core/permission';

import { SETTING_PAGE } from '../permission';

/** 系統設定頁：`system:read` 檢視，`system:update`（`canUpdate`）修改與還原預設。 */
export function useSettingPermission() {
  return usePagePermission(SETTING_PAGE);
}
