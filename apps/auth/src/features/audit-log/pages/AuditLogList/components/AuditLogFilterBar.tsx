import { useState } from 'react';
import type { FormEvent } from 'react';

import { Button } from '@/components/Button';
import { Field } from '@/components/Field';
import { Input } from '@/components/Input';
import { Select } from '@/components/Select';
import { useTranslation } from '@/core/locales';
import type { PlatformAuditLog } from '@/shared/api-sdk';

import { AUDIT_LOG_RESULT_ALL, AUDIT_LOG_RESULT_LABEL_KEY } from '../../../constants';
import type { AuditLogSearchQuery } from '../../../routes';

export interface AuditLogFilterValues {
  action?: string;
  actorEmail?: string;
  result?: PlatformAuditLog['result'];
}

interface AuditLogFilterBarProps {
  /** 目前網址上的條件；呼叫端以它們當 `key`，網址變了（例：重設）輸入框就跟著重來。 */
  search: AuditLogSearchQuery;
  onChange: (values: AuditLogFilterValues) => void;
}

type ResultOption = PlatformAuditLog['result'] | typeof AUDIT_LOG_RESULT_ALL;

/**
 * 篩選列：動作與操作者信箱按「搜尋」（或 Enter）才送出，結果選了就套用。
 * 空字串視為不篩選。
 */
export function AuditLogFilterBar({ search, onChange }: AuditLogFilterBarProps) {
  const { t } = useTranslation();
  const [action, setAction] = useState(search.action ?? '');
  const [actorEmail, setActorEmail] = useState(search.actorEmail ?? '');

  const resultOptions: Array<{ value: ResultOption; label: string }> = [
    { value: AUDIT_LOG_RESULT_ALL, label: t('auditLog.filter.all') },
    { value: 'success', label: t(AUDIT_LOG_RESULT_LABEL_KEY.success) },
    { value: 'failure', label: t(AUDIT_LOG_RESULT_LABEL_KEY.failure) },
  ];

  const submit = (event: FormEvent) => {
    event.preventDefault();
    onChange({
      action: action.trim() || undefined,
      actorEmail: actorEmail.trim() || undefined,
      result: search.result,
    });
  };

  return (
    <form
      className="flex flex-wrap items-end gap-3"
      onSubmit={submit}
      data-testid="audit-log-filter"
    >
      <Field label={t('auditLog.filter.action')} className="w-60">
        <Input
          size="sm"
          value={action}
          onChange={(event) => setAction(event.target.value)}
          placeholder={t('auditLog.filter.actionPlaceholder')}
          data-testid="audit-log-filter-action"
        />
      </Field>
      <Field label={t('auditLog.filter.actorEmail')} className="w-60">
        <Input
          size="sm"
          value={actorEmail}
          onChange={(event) => setActorEmail(event.target.value)}
          placeholder={t('auditLog.filter.actorEmailPlaceholder')}
          data-testid="audit-log-filter-actor-email"
        />
      </Field>
      <Field label={t('auditLog.filter.result')} className="w-36">
        <Select<ResultOption>
          size="sm"
          value={search.result ?? AUDIT_LOG_RESULT_ALL}
          options={resultOptions}
          onValueChange={(value) =>
            onChange({
              action: search.action,
              actorEmail: search.actorEmail,
              result: value === AUDIT_LOG_RESULT_ALL ? undefined : value,
            })
          }
          aria-label={t('auditLog.filter.result')}
          data-testid="audit-log-filter-result"
        />
      </Field>
      <div className="flex gap-2">
        <Button type="submit" size="sm" variant="primary" data-testid="audit-log-filter-submit">
          {t('auditLog.filter.search')}
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={() => onChange({})}
          data-testid="audit-log-filter-reset"
        >
          {t('auditLog.filter.reset')}
        </Button>
      </div>
    </form>
  );
}
