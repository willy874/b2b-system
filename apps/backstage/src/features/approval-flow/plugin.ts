import type { AppDynamicPluginFactory } from '@b2b-system/web-core/app';
import { LanguageNamespace, Languages } from '@b2b-system/web-shared/constants';

import { APPROVAL_FLOW_LOCALE_SCOPE } from './locale';
import { registerApprovalFlowNavigation } from './navigation';
import { registerApprovalFlowPagePermissions } from './permission';

/** 可啟用的 feature：由 `app/features.ts` 依租戶的啟用清單安裝（`approvalChain`，docs/architecture/backend/20-approval.md §9.11）。 */
export function appContextPlugin(): AppDynamicPluginFactory {
  return (context) => {
    // ── 同步階段：權限的註冊必須在第一次 render 之前完成 ──
    registerApprovalFlowPagePermissions();
    registerApprovalFlowNavigation(); // 側欄與命令面板的入口
    const app = context.getInstance();

    return {
      name: 'approval-flow-feature-plugin',
      onInit: () => {
        app.addResourceBundle(
          {
            [Languages.EN_US]: {
              [LanguageNamespace.TRANSLATE]: () => import('./locales/en_US.json'),
            },
            [Languages.ZH_TW]: {
              [LanguageNamespace.TRANSLATE]: () => import('./locales/zh_TW.json'),
            },
          },
          { scope: APPROVAL_FLOW_LOCALE_SCOPE },
        );
      },
    };
  };
}
