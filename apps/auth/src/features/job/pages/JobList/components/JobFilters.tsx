import { useState } from 'react';
import type { FormEvent } from 'react';

import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { Select } from '@/components/Select';
import type { SelectOption } from '@/components/Select';
import { useTranslation } from '@/core/locales';

import { JOB_STATE_LABEL_KEY, JOB_STATES, PLATFORM_TENANT_FILTER } from '../../../constants';
import type { JobSearchQuery } from '../../../routes';
import type { JobQueueVM } from '../adapter';
import type { JobFilter } from '../useJobSearchFilter';

/** Select 的「全部」選項：網址裡沒有這個參數。 */
const ALL = '';

interface JobFiltersProps {
  search: JobSearchQuery;
  queues: JobQueueVM[];
  onChange: (filter: JobFilter) => void;
}

/**
 * 篩選列：工作種類（選項來自佇列清單）、狀態、租戶。
 * 租戶是自由輸入的代碼（按 Enter 或「套用」才送出）；「只看平台」直接套用保留值 `platform`。
 */
export function JobFilters({ search, queues, onChange }: JobFiltersProps) {
  const { t } = useTranslation();
  const [tenantDraft, setTenantDraft] = useState(search.tenant ?? '');
  // 網址被外部改掉（上一頁、點「只看平台」）時，輸入框跟著網址
  const [syncedTenant, setSyncedTenant] = useState(search.tenant);
  if (syncedTenant !== search.tenant) {
    setSyncedTenant(search.tenant);
    setTenantDraft(search.tenant ?? '');
  }

  const nameOptions: SelectOption[] = [
    { value: ALL, label: t('job.filter.allNames') },
    ...queues.map((queue) => ({
      value: queue.name,
      label: queue.labelKey ? t(queue.labelKey) : queue.name,
    })),
  ];
  const stateOptions: SelectOption[] = [
    { value: ALL, label: t('job.filter.allStates') },
    ...JOB_STATES.map((state) => ({ value: state, label: t(JOB_STATE_LABEL_KEY[state]) })),
  ];

  const submitTenant = (event: FormEvent) => {
    event.preventDefault();
    onChange({ tenant: tenantDraft.trim().toLowerCase() || undefined });
  };

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="job-filters">
      <Select
        size="sm"
        value={search.name ?? ALL}
        options={nameOptions}
        onValueChange={(value) => onChange({ name: value || undefined })}
        aria-label={t('job.field.name')}
        data-testid="job-filter-name"
      />
      <Select
        size="sm"
        value={search.state ?? ALL}
        options={stateOptions}
        onValueChange={(value) => onChange({ state: JOB_STATES.find((state) => state === value) })}
        aria-label={t('job.field.state')}
        data-testid="job-filter-state"
      />
      <form className="flex items-center gap-2" onSubmit={submitTenant}>
        <Input
          size="sm"
          value={tenantDraft}
          onChange={(event) => setTenantDraft(event.target.value)}
          placeholder={t('job.filter.tenantPlaceholder')}
          aria-label={t('job.field.tenant')}
          data-testid="job-filter-tenant"
        />
        <Button type="submit" size="sm" data-testid="job-filter-tenant-apply">
          {t('job.filter.apply')}
        </Button>
      </form>
      <Button
        size="sm"
        variant={search.tenant === PLATFORM_TENANT_FILTER ? 'primary' : 'secondary'}
        aria-pressed={search.tenant === PLATFORM_TENANT_FILTER}
        onClick={() =>
          onChange({
            tenant: search.tenant === PLATFORM_TENANT_FILTER ? undefined : PLATFORM_TENANT_FILTER,
          })
        }
        data-testid="job-filter-platform"
      >
        {t('job.filter.platformOnly')}
      </Button>
    </div>
  );
}
