import { Button } from '@b2b-system/ui/Button';
import { Chip } from '@b2b-system/ui/Chip';
import { useConfirm } from '@b2b-system/ui/ConfirmDialog';
import { Field } from '@b2b-system/ui/Field';
import { Input, Textarea } from '@b2b-system/ui/Input';
import { Select } from '@b2b-system/ui/Select';
import { useErrorToast } from '@b2b-system/web-core/errors';
import { JOB_STATE_LABEL_KEY, JOB_STATE_TONE } from '@b2b-system/web-core/job';
import { useTranslation } from '@b2b-system/web-core/locales';
import { RouteLink } from '@b2b-system/web-core/route-link';
import { formatDateTime } from '@b2b-system/web-shared/date';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { FormEvent } from 'react';

import { getTenantListQueryOptions } from '@/apis/platform-tenant/get-tenant-list/query';
import type { CdnPurgeJobSummary, CdnPurgeRequest, CdnResource } from '@/shared/api-sdk';

import { CDN_PURGE_TARGET_LABEL_KEY } from '../../../constants';
import type { CdnPurgeTargetType } from '../../../constants';
import { usePurgeCdnMutation } from '../../../hooks/usePurgeCdnMutation';
import { Section } from './Section';

interface PurgeSectionProps {
  /** 有登記路徑解析器的資源類型。 */
  targets: CdnResource[];
  recent: CdnPurgeJobSummary[];
  /** 最近一次檢查的節點數（清空整個快取的確認框用）。 */
  nodeCount: number;
  canPurge: boolean;
  canPurgeAll: boolean;
}

/** 工作資料裡的目標種類（伺服器之後新增的種類退回「路徑」的名稱）。 */
function targetLabelKey(target: string): string {
  return target in CDN_PURGE_TARGET_LABEL_KEY
    ? CDN_PURGE_TARGET_LABEL_KEY[target as CdnPurgeTargetType]
    : CDN_PURGE_TARGET_LABEL_KEY.paths;
}

/** 選單一次載入的租戶數；更多時以搜尋縮小（代碼、名稱、網域）。 */
const TENANT_OPTIONS_LIMIT = 100;

/**
 * 手動清理（docs/architecture/backend/09-file.md §16.11）：路徑、資源或整個快取，排入 `cdn.purge`；
 * 最近 20 筆（手動與自動）列在下面，連到背景工作列表看每個節點的結果。沒有 `cdn:purge` 只看得到最近的清理。
 */
export function PurgeSection({
  targets,
  recent,
  nodeCount,
  canPurge,
  canPurgeAll,
}: PurgeSectionProps) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const showError = useErrorToast();
  const purge = usePurgeCdnMutation();
  const [type, setType] = useState<CdnPurgeTargetType>('paths');
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [paths, setPaths] = useState('');
  const [id, setId] = useState('');
  const tenants = useQuery({
    ...getTenantListQueryOptions({
      offset: 0,
      limit: TENANT_OPTIONS_LIMIT,
      q: search || undefined,
    }),
    enabled: canPurge && type !== 'all',
  });

  const types: CdnPurgeTargetType[] = [
    'paths',
    ...targets,
    ...(canPurgeAll ? ['all' as const] : []),
  ];
  const keys = paths
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const ready =
    type === 'all' ||
    (tenantId !== null && (type === 'paths' ? keys.length > 0 : id.trim() !== ''));

  const requestOf = (): CdnPurgeRequest | undefined => {
    if (type === 'all') return { target: { type: 'all' } };
    if (!tenantId) return undefined;
    if (type === 'paths') return { target: { type: 'paths', tenantId, paths: keys } };
    return { target: { type, tenantId, id: id.trim() } };
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const request = requestOf();
    if (!request) return;
    const send = () =>
      purge.mutateAsync({ params: request }).then(() => {
        setPaths('');
        setId('');
      });
    if (type !== 'all') {
      void send().catch(showError);
      return;
    }
    void confirm({
      title: t('cdn.purge.allTitle'),
      description: t('cdn.purge.allConfirm', { nodes: nodeCount }),
      confirmLabel: t('cdn.purge.allAction'),
      tone: 'danger',
      onConfirm: () =>
        send().catch((error: unknown) => {
          showError(error);
          throw error;
        }),
      'data-testid': 'cdn-purge-all-dialog',
    });
  };

  return (
    <Section
      title={t('cdn.purge.title')}
      description={t('cdn.purge.description')}
      data-testid="cdn-purge"
    >
      {canPurge && (
        <form className="flex flex-col gap-3" onSubmit={submit} data-testid="cdn-purge-form">
          <Field label={t('cdn.purge.target')}>
            <Select
              size="sm"
              value={type}
              options={types.map((value) => ({
                value,
                label: t(CDN_PURGE_TARGET_LABEL_KEY[value]),
              }))}
              onValueChange={(value) => setType(value)}
              aria-label={t('cdn.purge.target')}
              data-testid="cdn-purge-type"
            />
          </Field>
          {type !== 'all' && (
            <Field label={t('cdn.purge.tenant')}>
              <Select
                size="sm"
                searchable
                value={tenantId}
                placeholder={t('cdn.purge.tenantPlaceholder')}
                options={(tenants.data?.items ?? []).map((tenant) => ({
                  value: tenant.id,
                  label: `${tenant.code} · ${tenant.name}`,
                }))}
                filterOption={false}
                onSearchChange={setSearch}
                loading={tenants.isFetching}
                onValueChange={setTenantId}
                aria-label={t('cdn.purge.tenant')}
                data-testid="cdn-purge-tenant"
              />
            </Field>
          )}
          {type === 'paths' && (
            <Field label={t('cdn.purge.paths')}>
              <Textarea
                rows={4}
                value={paths}
                onChange={(event) => setPaths(event.target.value)}
                data-testid="cdn-purge-paths"
              />
            </Field>
          )}
          {type !== 'paths' && type !== 'all' && (
            <Field label={t('cdn.purge.id')}>
              <Input
                value={id}
                onChange={(event) => setId(event.target.value)}
                data-testid="cdn-purge-id"
              />
            </Field>
          )}
          <Button
            type="submit"
            variant={type === 'all' ? 'danger' : 'primary'}
            className="self-start"
            disabled={!ready || purge.isPending}
            loading={purge.isPending}
            data-testid="cdn-purge-submit"
          >
            {t('cdn.purge.submit')}
          </Button>
        </form>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="m-0 text-sm font-medium">{t('cdn.purge.recent')}</h3>
        <RouteLink
          to="job.byName"
          params={{ name: 'cdn.purge' }}
          fallback="hide"
          className="text-sm"
          data-testid="cdn-purge-jobs-link"
        >
          {t('cdn.purge.viewJobs')}
        </RouteLink>
      </div>
      {recent.length === 0 ? (
        <p className="m-0 text-sm text-[var(--color-fg-muted)]">{t('cdn.purge.recentEmpty')}</p>
      ) : (
        <ul
          className="m-0 flex list-none flex-col gap-1 p-0 text-sm"
          data-testid="cdn-recent-purges"
        >
          {recent.map((job) => (
            <li
              key={job.id}
              className="flex flex-wrap items-center gap-2"
              data-testid="cdn-recent-purge"
              data-value={job.id}
            >
              <Chip tone={JOB_STATE_TONE[job.state]}>{t(JOB_STATE_LABEL_KEY[job.state])}</Chip>
              <span>{formatDateTime(job.createdOn)}</span>
              <span>
                {job.paths === 'all'
                  ? t('cdn.purge.allPaths')
                  : t('cdn.purge.pathCount', { count: job.paths })}
              </span>
              <span className="text-[var(--color-fg-muted)]">
                {job.manual ? t(targetLabelKey(job.manual.target)) : t('cdn.purge.automatic')}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
