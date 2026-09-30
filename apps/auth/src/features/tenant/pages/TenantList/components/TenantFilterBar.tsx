import { useState } from 'react';
import type { FormEvent } from 'react';

import { Button } from '@/components/Button';
import { Field } from '@/components/Field';
import { Input } from '@/components/Input';
import { Select } from '@/components/Select';
import { useTranslation } from '@/core/locales';
import type { PlatformTenant } from '@/shared/api-sdk';

import { TENANT_STATUS_ALL, TENANT_STATUS_LABEL_KEY } from '../../../constants';
import type { TenantSearchQuery } from '../../../routes';

export interface TenantFilterValues {
  q?: string;
  status?: PlatformTenant['status'];
}

interface TenantFilterBarProps {
  /** 目前網址上的條件；呼叫端以 `q` 當 `key`，網址變了（例：重設）輸入框就跟著重來。 */
  search: TenantSearchQuery;
  onChange: (values: TenantFilterValues) => void;
}

type StatusOption = PlatformTenant['status'] | typeof TENANT_STATUS_ALL;

/** 篩選列：關鍵字按「搜尋」（或 Enter）才送出，狀態選了就套用。空字串視為不篩選。 */
export function TenantFilterBar({ search, onChange }: TenantFilterBarProps) {
  const { t } = useTranslation();
  const [q, setQ] = useState(search.q ?? '');

  const statusOptions: Array<{ value: StatusOption; label: string }> = [
    { value: TENANT_STATUS_ALL, label: t('tenant.filter.all') },
    { value: 'active', label: t(TENANT_STATUS_LABEL_KEY.active) },
    { value: 'provisioning', label: t(TENANT_STATUS_LABEL_KEY.provisioning) },
    { value: 'failed', label: t(TENANT_STATUS_LABEL_KEY.failed) },
    { value: 'disabled', label: t(TENANT_STATUS_LABEL_KEY.disabled) },
  ];

  const submit = (event: FormEvent) => {
    event.preventDefault();
    onChange({ q: q.trim() || undefined, status: search.status });
  };

  return (
    <form className="flex flex-wrap items-end gap-3" onSubmit={submit} data-testid="tenant-filter">
      <Field label={t('tenant.filter.q')} className="w-72">
        <Input
          size="sm"
          type="search"
          value={q}
          onChange={(event) => setQ(event.target.value)}
          placeholder={t('tenant.filter.qPlaceholder')}
          data-testid="tenant-filter-q"
        />
      </Field>
      <Field label={t('tenant.field.status')} className="w-36">
        <Select<StatusOption>
          size="sm"
          value={search.status ?? TENANT_STATUS_ALL}
          options={statusOptions}
          onValueChange={(value) =>
            onChange({ q: search.q, status: value === TENANT_STATUS_ALL ? undefined : value })
          }
          aria-label={t('tenant.field.status')}
          data-testid="tenant-filter-status"
        />
      </Field>
      <div className="flex gap-2">
        <Button type="submit" size="sm" variant="primary" data-testid="tenant-filter-submit">
          {t('common.search')}
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={() => onChange({})}
          data-testid="tenant-filter-reset"
        >
          {t('common.reset')}
        </Button>
      </div>
    </form>
  );
}
