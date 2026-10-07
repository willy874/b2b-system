import { useCallback } from 'react';

import { useTranslation } from '../locales';
import { ISSUE_MESSAGE_KEY } from './constants';
import type { RowIssue } from './types';

function listText(value: unknown, separator: string): string {
  return Array.isArray(value) ? value.map(String).join(separator) : String(value ?? '');
}

/** 問題代碼 → 目前語系的訊息；有建議值時附在後面。 */
export function useIssueMessage(): (issue: Pick<RowIssue, 'code' | 'params'>) => string {
  const { t } = useTranslation();
  return useCallback(
    (issue) => {
      const params = issue.params ?? {};
      const separator = t('dataTransfer.separator');
      const values = {
        ...params,
        rows: listText(params.rows, separator),
        names: listText(params.names, separator),
        options: listText(params.options, separator),
        value: String(params.value ?? ''),
      };
      const key =
        issue.code === 'invalidFormat' && params.format === 'email'
          ? 'dataTransfer.issue.invalidFormatEmail'
          : ISSUE_MESSAGE_KEY[issue.code];
      const message = key ? t(key, values) : t('dataTransfer.issue.unknown', { code: issue.code });
      return typeof params.suggestion === 'string'
        ? `${message}${t('common.parenthetical', { text: t('dataTransfer.issue.suggestion', { value: params.suggestion }) })}`
        : message;
    },
    [t],
  );
}
