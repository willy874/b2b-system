import { Button } from '@b2b-system/ui/Button';
import { FileUpload } from '@b2b-system/ui/FileUpload';
import { Icon } from '@b2b-system/ui/Icon';
import { Select } from '@b2b-system/ui/Select';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import {
  COLUMN_KIND_LABEL_KEY,
  downloadBlob,
  IMPORT_ACCEPT,
  IMPORT_TEMPLATE_FORMATS,
} from '../data-transfer';
import type {
  AnalyzeOptions,
  ImportApi,
  ImportColumnView,
  ImportFormat,
  ImportMode,
} from '../data-transfer';
import { useErrorToast } from '../errors';
import { useTranslation } from '../locales';

type Encoding = AnalyzeOptions['encoding'];

const ENCODING_LABEL_KEY = {
  auto: 'dataTransfer.import.encodingAuto',
  'utf-8': 'dataTransfer.import.encodingUtf8',
  big5: 'dataTransfer.import.encodingBig5',
  'utf-16': 'dataTransfer.import.encodingUtf16',
} as const satisfies Record<Encoding, string>;

const TEMPLATE_LABEL_KEY = {
  xlsx: 'dataTransfer.import.templateXlsx',
  csv: 'dataTransfer.import.templateCsv',
  json: 'dataTransfer.import.templateJson',
  yaml: 'dataTransfer.import.templateYaml',
} as const satisfies Record<ImportFormat, string>;

export interface ImportSetupProps {
  api: ImportApi;
  type: string;
  mode: ImportMode;
  /** 上一次分析回報有多個工作表時，讓使用者改選。 */
  sheets?: string[];
  analyzing: boolean;
  onAnalyze: (file: File, options: Omit<AnalyzeOptions, 'mode'>) => void;
  onManual: (columns: ImportColumnView[]) => void;
}

/**
 * 步驟 2～3（docs/architecture/backend/22-data-transfer.md §7.2）：上傳（或直接輸入），下方是範本與欄位說明。
 * 上傳區在最上面：熟悉的人直接選檔分析，第一次用的人往下看說明、下載範本。
 */
export function ImportSetup({
  api,
  type,
  mode,
  sheets,
  analyzing,
  onAnalyze,
  onManual,
}: ImportSetupProps) {
  const { t } = useTranslation();
  const showError = useErrorToast();
  const [files, setFiles] = useState<File[]>([]);
  const [encoding, setEncoding] = useState<Encoding>('auto');
  const [sheet, setSheet] = useState<string | undefined>();
  const columns = useQuery({
    queryKey: api.columnsKey(type, mode),
    queryFn: ({ signal }) => api.fetchColumns(type, mode, signal),
  });

  const downloadTemplate = (format: ImportFormat) =>
    void api
      .downloadTemplate(type, mode, format)
      .then(({ blob, fileName }) => downloadBlob(blob, fileName), showError);

  const file = files[0];

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <FileUpload
          files={files}
          onFilesChange={setFiles}
          accept={IMPORT_ACCEPT}
          disabled={analyzing}
          labels={{
            hint: t('dataTransfer.import.uploadHint'),
            browse: t('dataTransfer.import.uploadBrowse'),
            remove: t('dataTransfer.import.uploadRemove'),
            wrongType: t('dataTransfer.import.uploadWrongType'),
          }}
          aria-label={t('dataTransfer.import.uploadBrowse')}
          data-testid="import-upload"
        />
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm">
            {t('dataTransfer.import.encoding')}
            <Select<Encoding>
              value={encoding}
              onValueChange={(value) => value && setEncoding(value)}
              options={(Object.keys(ENCODING_LABEL_KEY) as Encoding[]).map((value) => ({
                value,
                label: t(ENCODING_LABEL_KEY[value]),
              }))}
              size="sm"
              aria-label={t('dataTransfer.import.encoding')}
            />
          </label>
          {sheets && sheets.length > 1 && (
            <label className="flex flex-col gap-1 text-sm">
              {t('dataTransfer.import.sheet')}
              <Select<string>
                value={sheet ?? sheets[0] ?? ''}
                onValueChange={(value) => value && setSheet(value)}
                options={sheets.map((name) => ({ value: name, label: name }))}
                size="sm"
                aria-label={t('dataTransfer.import.sheet')}
                data-testid="import-sheet"
              />
            </label>
          )}
          <span className="flex-1" />
          <Button
            variant="secondary"
            onClick={() => columns.data && onManual(columns.data.items)}
            disabled={!columns.data || analyzing}
            data-testid="import-manual"
          >
            {t('dataTransfer.import.manual')}
          </Button>
          <Button
            variant="primary"
            onClick={() => file && onAnalyze(file, { encoding, ...(sheet ? { sheet } : {}) })}
            disabled={!file}
            loading={analyzing}
            data-testid="import-analyze"
          >
            {t('dataTransfer.import.analyze')}
          </Button>
        </div>
        {analyzing && file && (
          <output className="m-0 block text-sm text-[var(--color-fg-muted)]">
            {t('dataTransfer.import.analyzing', { fileName: file.name })}
          </output>
        )}
      </section>
      <section className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <h2 className="m-0 text-base font-semibold">{t('dataTransfer.import.guide')}</h2>
          <span className="flex-1" />
          {IMPORT_TEMPLATE_FORMATS.map((format) => (
            <Button
              key={format}
              size="sm"
              variant="secondary"
              startIcon={<Icon name="download" size={14} />}
              onClick={() => downloadTemplate(format)}
              data-testid={`import-template-${format}`}
            >
              {t(TEMPLATE_LABEL_KEY[format])}
            </Button>
          ))}
        </div>
        <div className="overflow-x-auto rounded-[var(--radius-md)] border border-[var(--color-border)]">
          <table className="w-full border-collapse text-sm" data-testid="import-guide">
            <thead className="bg-[var(--color-fill-subtle)] text-left">
              <tr>
                <th className="whitespace-nowrap px-3 py-2">
                  {t('dataTransfer.import.guideColumn')}
                </th>
                <th className="whitespace-nowrap px-3 py-2">
                  {t('dataTransfer.import.guideRequired')}
                </th>
                <th className="whitespace-nowrap px-3 py-2">
                  {t('dataTransfer.import.guideFormat')}
                </th>
                <th className="whitespace-nowrap px-3 py-2">
                  {t('dataTransfer.import.guideOptions')}
                </th>
                <th className="px-3 py-2">{t('dataTransfer.import.guideNotes')}</th>
              </tr>
            </thead>
            <tbody>
              {(columns.data?.items ?? []).map((column) => (
                <tr key={column.key} className="border-t border-[var(--color-border)]">
                  <td className="whitespace-nowrap px-3 py-2 font-medium">
                    {column.label}
                    {column.matchKey !== null && (
                      <span className="ml-2 text-xs text-[var(--color-fg-muted)]">
                        {t('dataTransfer.import.matchKey')}
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    {column.required ? t('common.yes') : ''}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    {t(COLUMN_KIND_LABEL_KEY[column.kind])}
                  </td>
                  <td className="px-3 py-2">
                    {column.options
                      ?.map((option) => option.label)
                      .join(t('dataTransfer.separator')) ?? ''}
                  </td>
                  <td className="min-w-60 px-3 py-2 text-[var(--color-fg-muted)]">
                    {[
                      column.hint,
                      column.multiple ? t('dataTransfer.import.multiple') : null,
                      mode === 'update' && column.nullable
                        ? t('dataTransfer.import.nullable')
                        : null,
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
