import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { getFileTextQueryOptions } from '@/apis/file/get-file-text/query';
import { Spinner } from '@/components/Spinner';
import { useErrorMessage } from '@/core/errors';
import type { FilePreviewerProps } from '@/core/file';
import { useTranslation } from '@/core/locales';

/** 預覽只讀開頭：再長也沒人會在預覽裡捲完，完整內容請下載。 */
export const TEXT_PREVIEW_MAX_BYTES = 256 * 1024;

/** JSON 排版後比較好讀；解析失敗（截斷、本來就不是 JSON）就照原樣顯示。 */
function prettify(text: string, contentType: string, truncated: boolean): string {
  if (truncated || !contentType.includes('json')) return text;
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

/** 純文字預覽：只讀前 256 KB，JSON 自動排版，保留原本的換行與空白。 */
export function TextPreview({ file }: FilePreviewerProps) {
  const { t } = useTranslation();
  const errorMessage = useErrorMessage();
  const { data, error, isPending } = useQuery({
    ...getFileTextQueryOptions({
      fileId: file.id,
      url: file.url ?? '',
      maxBytes: TEXT_PREVIEW_MAX_BYTES,
    }),
    enabled: Boolean(file.url),
  });
  const text = useMemo(
    () => (data ? prettify(data.text, file.contentType, data.truncated) : ''),
    [data, file.contentType],
  );

  if (error) {
    return (
      <p className="p-4 text-sm text-[var(--color-danger-text)]" role="alert">
        {errorMessage(error)}
      </p>
    );
  }
  if (isPending) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner label={t('common.loading')} />
      </div>
    );
  }
  return (
    <div className="flex h-full flex-col gap-2" data-testid="file-preview-text">
      {data?.truncated && (
        <p
          className="m-0 text-xs text-[var(--color-fg-muted)]"
          data-testid="file-preview-truncated"
        >
          {t('file.preview.truncated', { size: '256 KB' })}
        </p>
      )}
      <pre className="m-0 min-h-0 flex-1 overflow-auto rounded bg-[var(--color-fill-subtle)] p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words">
        {text}
      </pre>
    </div>
  );
}
