import { useState } from 'react';

import { Button } from '@/components/Button';
import { DateRangePicker } from '@/components/DatePicker';
import { Input } from '@/components/Input';
import { Select } from '@/components/Select';
import { useTranslation } from '@/core/locales';

import type { AuditLogSearchQuery } from '../../../routes';

interface AuditLogFilterProps {
  search: AuditLogSearchQuery;
  onChange: (filter: Partial<Omit<AuditLogSearchQuery, 'offset' | 'limit'>>) => void;
}

/** 動作關鍵字（按 Enter 或搜尋鈕才送出）、資源、結果、日期區間。 */
export function AuditLogFilter({ search, onChange }: AuditLogFilterProps) {
  const { t } = useTranslation();
  const [actionDraft, setActionDraft] = useState(search.action ?? '');

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        placeholder={t('auditLog.filter.actionPlaceholder')}
        value={actionDraft}
        onChange={(event) => setActionDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') onChange({ action: actionDraft || undefined });
        }}
        className="max-w-xs"
        data-testid="audit-log-action-input"
      />
      <Select
        value={search.resourceType ?? 'all'}
        onValueChange={(value) => onChange({ resourceType: value === 'all' ? undefined : value })}
        options={[
          { value: 'all', label: t('auditLog.filter.allResources') },
          { value: 'user', label: t('permission.resource.user') },
          { value: 'role', label: t('permission.resource.role') },
          { value: 'auth', label: t('auditLog.resource.auth') },
          { value: 'authz', label: t('auditLog.resource.authz') },
        ]}
        className="w-44"
        aria-label={t('auditLog.field.resource')}
      />
      <Select
        value={search.result ?? 'all'}
        onValueChange={(value) =>
          onChange({
            result: value === 'all' ? undefined : (value as AuditLogSearchQuery['result']),
          })
        }
        options={[
          { value: 'all', label: t('auditLog.filter.allResults') },
          { value: 'success', label: t('auditLog.result.success') },
          { value: 'failure', label: t('auditLog.result.failure') },
        ]}
        className="w-36"
        aria-label={t('auditLog.field.result')}
      />
      <DateRangePicker
        value={{ from: search.from ?? null, to: search.to ?? null }}
        onValueChange={({ from, to }) => onChange({ from: from ?? undefined, to: to ?? undefined })}
        className="max-w-64"
        aria-label={t('auditLog.filter.range')}
        labels={{
          clear: t('common.reset'),
          open: t('auditLog.filter.range'),
          separator: '~',
        }}
        data-testid="audit-log-range"
      />
      <Button onClick={() => onChange({ action: actionDraft || undefined })}>
        {t('common.search')}
      </Button>
    </div>
  );
}
