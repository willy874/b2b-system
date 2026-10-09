import { Button } from '@b2b-system/ui/Button';
import { Checkbox } from '@b2b-system/ui/Checkbox';
import { Chip } from '@b2b-system/ui/Chip';
import { useConfirm } from '@b2b-system/ui/ConfirmDialog';
import { Field } from '@b2b-system/ui/Field';
import { NumberField } from '@b2b-system/ui/NumberField';
import { Switch } from '@b2b-system/ui/Switch';
import { ErrorCodes, isAppError, useErrorToast } from '@b2b-system/web-core/errors';
import { useTranslation } from '@b2b-system/web-core/locales';
import { formatDateTime } from '@b2b-system/web-shared/date';
import { useState } from 'react';

import type {
  CdnCheckNode,
  CdnCheckResult,
  CdnDeployment,
  CdnEffective,
  CdnResource,
  CdnStoredSettings,
  UpdateCdnSettingsRequest,
} from '@/shared/api-sdk';

import { CDN_RESOURCE_LABEL_KEY, CDN_RESOURCES } from '../../../constants';
import { useUpdateCdnSettingsMutation } from '../../../hooks/useUpdateCdnSettingsMutation';
import { NodeProblemList } from './NodeProblemList';
import { Section } from './Section';

interface SettingsSectionProps {
  deployment: CdnDeployment;
  settings: CdnStoredSettings;
  effective: CdnEffective;
  canUpdate: boolean;
}

/** 開啟被拒（409 `CDN_NOT_READY`）時伺服器帶回的節點問題。 */
interface NotReady {
  nodes: Array<Pick<CdnCheckNode, 'address' | 'problems'>>;
  discovery?: CdnCheckResult['discovery'];
}

type Changes = Omit<UpdateCdnSettingsRequest, 'version'>;

function notReadyOf(error: unknown): NotReady | undefined {
  if (!isAppError(error) || error.code !== ErrorCodes.CDN_NOT_READY) return undefined;
  const nodes = Array.isArray(error.details?.nodes)
    ? (error.details.nodes as NotReady['nodes'])
    : [];
  const discovery = error.details?.discovery as CdnCheckResult['discovery'] | undefined;
  return { nodes, discovery };
}

/**
 * 執行期的設定（docs/architecture/backend/09-file.md §16.9、§16.12）。每個控制項各自送出「只有那個欄位 ＋ version」：
 * 關閉不檢查（事故時要能立刻關）；開啟與加入資源類型被伺服器以節點檢查擋下時，問題直接顯示在開關旁。
 */
export function SettingsSection({
  deployment,
  settings,
  effective,
  canUpdate,
}: SettingsSectionProps) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const showError = useErrorToast();
  const update = useUpdateCdnSettingsMutation();
  const [notReady, setNotReady] = useState<NotReady>();
  const [ttl, setTtl] = useState<number | null>(settings.urlTtlCap);
  const [batch, setBatch] = useState<number | null>(settings.purgeBatchSize);
  const disabled = !canUpdate || update.isPending;

  const save = async (changes: Changes): Promise<void> => {
    setNotReady(undefined);
    try {
      await update.mutateAsync({ params: { version: settings.version, ...changes } });
    } catch (error) {
      const problems = notReadyOf(error);
      if (problems) setNotReady(problems);
      else showError(error);
      throw error;
    }
  };
  const fire = (changes: Changes) => void save(changes).catch(() => undefined);

  const toggleServing = (checked: boolean) => {
    if (checked) {
      fire({ state: 'on' });
      return;
    }
    const expiresAt = new Date(Date.now() + effective.urlTtlCap * 1000).toISOString();
    void confirm({
      title: t('cdn.settings.offTitle'),
      description: t('cdn.settings.offConfirm', { time: formatDateTime(expiresAt) }),
      confirmLabel: t('cdn.settings.offAction'),
      tone: 'danger',
      onConfirm: () => save({ state: 'off' }),
      'data-testid': 'cdn-off-dialog',
    });
  };

  const toggleResource = (resource: CdnResource, checked: boolean) => {
    const next = CDN_RESOURCES.filter((item) =>
      item === resource ? checked : effective.resources.includes(item),
    );
    fire({ resources: next });
  };

  const togglePurgeOnDelete = (checked: boolean) => {
    if (checked) {
      fire({ purgeOnDelete: true });
      return;
    }
    void confirm({
      title: t('cdn.settings.purgeOnDeleteOffTitle'),
      description: t('cdn.settings.purgeOnDeleteOffConfirm', { seconds: effective.urlTtlCap }),
      confirmLabel: t('cdn.settings.purgeOnDeleteOffAction'),
      tone: 'danger',
      onConfirm: () => save({ purgeOnDelete: false }),
      'data-testid': 'cdn-purge-on-delete-dialog',
    });
  };

  const clampedResources = effective.clamped.resources;
  return (
    <Section title={t('cdn.settings.title')} data-testid="cdn-settings">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <Switch
            checked={effective.serving}
            disabled={disabled}
            onCheckedChange={toggleServing}
            aria-label={t('cdn.settings.serving')}
            data-testid="cdn-serving"
          />
          <span className="font-medium">{t('cdn.settings.serving')}</span>
          {settings.state !== null && <Chip tone="neutral">{t('cdn.settings.overridden')}</Chip>}
        </div>
        <p className="m-0 text-sm text-[var(--color-fg-muted)]">{t('cdn.settings.servingHint')}</p>
        {settings.stateChangedAt && (
          <p className="m-0 text-sm" data-testid="cdn-state-changed">
            {t('cdn.settings.changedBy', {
              email: settings.stateChangedBy?.email ?? settings.stateChangedBy?.id ?? '',
              time: formatDateTime(settings.stateChangedAt),
            })}
          </p>
        )}
        {effective.issuedUrlsExpireAt && (
          <p
            className="m-0 text-sm text-[var(--color-warning-text)]"
            data-testid="cdn-issued-expire"
          >
            {t('cdn.settings.issuedUrlsExpireAt', {
              time: formatDateTime(effective.issuedUrlsExpireAt),
            })}
          </p>
        )}
        {notReady && (
          <div
            className="flex flex-col gap-1 rounded-[var(--radius-md)] border border-[var(--color-danger)] p-3"
            role="alert"
            data-testid="cdn-not-ready"
          >
            <span className="text-sm font-medium text-[var(--color-danger-text)]">
              {t('cdn.settings.notReady')}
            </span>
            <NodeProblemList nodes={notReady.nodes} discovery={notReady.discovery} />
          </div>
        )}
      </div>

      <Field label={t('cdn.settings.resources')}>
        <div className="flex flex-col gap-2" data-testid="cdn-resources">
          {CDN_RESOURCES.map((resource) => {
            const allowed = deployment.resources.includes(resource);
            return (
              <Checkbox
                key={resource}
                checked={effective.resources.includes(resource)}
                disabled={disabled || !allowed}
                onCheckedChange={(checked) => toggleResource(resource, checked)}
                label={t(CDN_RESOURCE_LABEL_KEY[resource])}
                description={allowed ? undefined : t('cdn.settings.resourceNotDeployed')}
                data-testid="cdn-resource"
                data-value={resource}
              />
            );
          })}
          {clampedResources.length > 0 && (
            <p
              className="m-0 text-sm text-[var(--color-warning-text)]"
              data-testid="cdn-resources-clamped"
            >
              {t('cdn.settings.resourcesClamped', {
                resources: clampedResources
                  .map((resource) => t(CDN_RESOURCE_LABEL_KEY[resource]))
                  .join(', '),
              })}
            </p>
          )}
        </div>
      </Field>

      <Field
        label={t('cdn.settings.urlTtlCap')}
        description={t('cdn.settings.urlTtlCapRange', {
          min: deployment.minUrlTtl,
          max: deployment.maxUrlTtl,
        })}
      >
        <div className="flex flex-wrap items-center gap-2">
          <NumberField
            size="sm"
            value={ttl ?? effective.urlTtlCap}
            min={deployment.minUrlTtl}
            max={deployment.maxUrlTtl}
            disabled={disabled}
            onValueChange={setTtl}
            data-testid="cdn-url-ttl"
          />
          {canUpdate && (
            <>
              <Button
                size="sm"
                disabled={disabled}
                onClick={() => fire({ urlTtlCap: ttl })}
                data-testid="cdn-url-ttl-save"
              >
                {t('cdn.settings.save')}
              </Button>
              {settings.urlTtlCap !== null && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={disabled}
                  onClick={() => {
                    setTtl(null);
                    fire({ urlTtlCap: null });
                  }}
                >
                  {t('cdn.settings.reset')}
                </Button>
              )}
            </>
          )}
        </div>
        {effective.clamped.urlTtlCap && (
          <p className="m-0 text-sm text-[var(--color-warning-text)]">
            {t('cdn.settings.urlTtlCapClamped', { value: effective.urlTtlCap })}
          </p>
        )}
      </Field>

      <div className="flex flex-wrap items-center gap-3">
        <Switch
          checked={effective.purgeOnDelete}
          disabled={disabled || (!deployment.purgeConfigured && !effective.purgeOnDelete)}
          onCheckedChange={togglePurgeOnDelete}
          aria-label={t('cdn.settings.purgeOnDelete')}
          data-testid="cdn-purge-on-delete"
        />
        <span>{t('cdn.settings.purgeOnDelete')}</span>
        {settings.purgeOnDelete !== null && (
          <Chip tone="neutral">{t('cdn.settings.overridden')}</Chip>
        )}
      </div>

      <Field label={t('cdn.settings.purgeBatchSize')}>
        <div className="flex flex-wrap items-center gap-2">
          <NumberField
            size="sm"
            value={batch ?? effective.purgeBatchSize}
            min={1}
            max={1000}
            disabled={disabled}
            onValueChange={setBatch}
            data-testid="cdn-purge-batch"
          />
          {canUpdate && (
            <Button size="sm" disabled={disabled} onClick={() => fire({ purgeBatchSize: batch })}>
              {t('cdn.settings.save')}
            </Button>
          )}
        </div>
      </Field>
    </Section>
  );
}
