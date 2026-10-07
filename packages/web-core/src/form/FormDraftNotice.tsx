import { Button } from '@b2b-system/ui/Button';
import { formatDateTime } from '@b2b-system/web-shared/date';

import { useTranslation } from '../locales';
import type { FormDraftState } from './useFormDraft';

/** `useFormDraft` 的提示列：「有上次未儲存的內容（時間）」＋ 還原、捨棄；沒有草稿時不顯示。 */
export function FormDraftNotice({ draft }: { draft: FormDraftState }) {
  const { t } = useTranslation();
  if (draft.savedAt === undefined) return null;
  return (
    <div
      className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 py-2 text-sm"
      data-testid="form-draft-notice"
    >
      <output>
        {t('common.formDraft.message', { time: formatDateTime(new Date(draft.savedAt)) })}
      </output>
      <span className="flex gap-2">
        <Button
          size="sm"
          variant="primary"
          onClick={draft.restore}
          data-testid="form-draft-restore"
        >
          {t('common.formDraft.restore')}
        </Button>
        <Button size="sm" variant="ghost" onClick={draft.discard} data-testid="form-draft-discard">
          {t('common.formDraft.discard')}
        </Button>
      </span>
    </div>
  );
}
