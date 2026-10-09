import { Button } from '@b2b-system/ui/Button';
import { useTranslation } from '@b2b-system/web-core/locales';

import type { FlowTemplate } from '../../../templates';

interface FlowTemplatePickerProps {
  templates: readonly FlowTemplate[];
  onPick: (template: FlowTemplate) => void;
}

/**
 * 第一次設定流程：先選一個範本（docs/architecture/backend/20-approval.md §9.16、§12 D6）。範本只產生草稿，
 * 選了之後照常編輯；需要指定對象的關卡留空讓使用者選。
 */
export function FlowTemplatePicker({ templates, onPick }: FlowTemplatePickerProps) {
  const { t } = useTranslation();
  return (
    <section className="flex flex-col gap-3" data-testid="approval-flow-templates">
      <div>
        <h3 className="m-0 text-base font-semibold">{t('approvalFlow.template.title')}</h3>
        <p className="mt-1 mb-0 text-sm text-[var(--color-fg-muted)]">
          {t('approvalFlow.template.description')}
        </p>
      </div>
      <ul className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2">
        {templates.map((template) => (
          <li
            key={template.id}
            className="flex flex-col gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-4"
          >
            <span className="font-medium">{t(template.labelKey)}</span>
            <span className="flex-1 text-sm text-[var(--color-fg-muted)]">
              {t(template.descriptionKey)}
            </span>
            <div>
              <Button
                size="sm"
                variant={template.id === 'blank' ? 'secondary' : 'primary'}
                onClick={() => onPick(template)}
                data-testid="approval-flow-template"
                data-value={template.id}
              >
                {t('approvalFlow.template.use')}
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
