import { Switch } from '@b2b-system/ui/Switch';
import { useTranslation } from '@b2b-system/web-core/locales';

import type { FlowDraft } from '../../../hooks/flowDraft';

interface FlowSettingsSectionProps {
  draft: FlowDraft;
  readOnly: boolean;
  onChange: (patch: Partial<Pick<FlowDraft, 'enabled' | 'allowRepeatApprover'>>) => void;
}

/** 流程的兩個開關：啟用（停用時回到單關審批，設定保留）、同一個人能不能審兩關（D6）。 */
export function FlowSettingsSection({ draft, readOnly, onChange }: FlowSettingsSectionProps) {
  const { t } = useTranslation();
  return (
    <section className="flex flex-col gap-3 rounded-md border border-[var(--color-border)] p-4">
      <div className="flex items-center justify-between gap-4 text-sm">
        <span>
          <span className="font-medium">{t('approvalFlow.edit.enabled')}</span>
          <span className="block text-[var(--color-fg-muted)]">
            {t('approvalFlow.edit.enabledHint')}
          </span>
        </span>
        <Switch
          aria-label={t('approvalFlow.edit.enabled')}
          checked={draft.enabled}
          disabled={readOnly}
          onCheckedChange={(enabled) => onChange({ enabled })}
          data-testid="approval-flow-enabled"
        />
      </div>
      <div className="flex items-center justify-between gap-4 text-sm">
        <span>
          <span className="font-medium">{t('approvalFlow.edit.allowRepeatApprover')}</span>
          <span className="block text-[var(--color-fg-muted)]">
            {t('approvalFlow.edit.allowRepeatApproverHint')}
          </span>
        </span>
        <Switch
          aria-label={t('approvalFlow.edit.allowRepeatApprover')}
          checked={draft.allowRepeatApprover}
          disabled={readOnly}
          onCheckedChange={(allowRepeatApprover) => onChange({ allowRepeatApprover })}
          data-testid="approval-flow-allow-repeat"
        />
      </div>
    </section>
  );
}
