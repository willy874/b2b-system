import { Button } from '@b2b-system/ui/Button';
import { Select } from '@b2b-system/ui/Select';
import { useState } from 'react';

import { useTranslation } from '../locales';
import type { PendingMapping } from './useImportWorkspace';

/** 「忽略」在下拉選單裡的值（欄位 key 不會是空字串）。 */
const IGNORE = '';

export interface ImportMappingProps {
  mapping: PendingMapping;
  busy: boolean;
  onConfirm: (selection: Record<number, string | null>) => void;
  onCancel: () => void;
}

/**
 * 步驟 5（docs/architecture/backend/22-data-transfer.md §7.2、§7.3）：檔案中有對不上的標頭時才出現。左邊是標頭與前 5 列樣本，
 * 右邊選要對應的欄位或「忽略」；確認後以記憶體中的同一個檔案加上 `mapping` 再分析一次，不必重新選檔。
 */
export function ImportMapping({ mapping, busy, onConfirm, onCancel }: ImportMappingProps) {
  const { t } = useTranslation();
  const ignoredReason = new Map(mapping.ignored.map((item) => [item.index, item.reason]));
  const [selection, setSelection] = useState<Record<number, string>>(() =>
    Object.fromEntries(
      mapping.headers.map((header) => [header.index, header.suggestion ?? IGNORE]),
    ),
  );
  const options = [
    { value: IGNORE, label: t('dataTransfer.import.mappingIgnore') },
    ...mapping.columns.map((column) => ({ value: column.key, label: column.label })),
  ];

  return (
    <section className="flex flex-col gap-4" data-testid="import-mapping">
      <div>
        <h2 className="m-0 text-base font-semibold">{t('dataTransfer.import.mappingTitle')}</h2>
        <p className="mt-1 text-sm text-[var(--color-fg-muted)]">
          {t('dataTransfer.import.mappingDescription')}
        </p>
      </div>
      <div className="overflow-x-auto rounded-[var(--radius-md)] border border-[var(--color-border)]">
        <table className="w-full border-collapse text-sm">
          <thead className="bg-[var(--color-fill-subtle)] text-left">
            <tr>
              <th className="px-3 py-2">{t('dataTransfer.import.mappingSource')}</th>
              <th className="px-3 py-2">{t('dataTransfer.import.mappingSample')}</th>
              <th className="px-3 py-2">{t('dataTransfer.import.mappingTarget')}</th>
            </tr>
          </thead>
          <tbody>
            {mapping.headers.map((header) => {
              const reason = ignoredReason.get(header.index);
              return (
                <tr key={header.index} className="border-t border-[var(--color-border)]">
                  <td className="px-3 py-2 font-medium">{header.text}</td>
                  <td className="max-w-80 truncate px-3 py-2 text-[var(--color-fg-muted)]">
                    {mapping.samples
                      .map((row) => row[header.index] ?? '')
                      .filter(Boolean)
                      .join(t('dataTransfer.separator'))}
                  </td>
                  <td className="px-3 py-2">
                    {reason ? (
                      <span className="text-[var(--color-fg-muted)]">
                        {reason === 'forbidden'
                          ? t('dataTransfer.import.mappingForbidden')
                          : t('dataTransfer.import.mappingReadOnly')}
                      </span>
                    ) : (
                      <Select<string>
                        value={selection[header.index] ?? IGNORE}
                        onValueChange={(value) =>
                          setSelection((current) => ({ ...current, [header.index]: value }))
                        }
                        options={options}
                        size="sm"
                        aria-label={header.text}
                        data-testid="import-mapping-select"
                      />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel} disabled={busy}>
          {t('common.cancel')}
        </Button>
        <Button
          variant="primary"
          loading={busy}
          onClick={() =>
            onConfirm(
              Object.fromEntries(
                Object.entries(selection).map(([index, key]) => [
                  Number(index),
                  key === IGNORE ? null : key,
                ]),
              ),
            )
          }
          data-testid="import-mapping-confirm"
        >
          {t('dataTransfer.import.mappingConfirm')}
        </Button>
      </div>
    </section>
  );
}
