import { useTranslation } from '@b2b-system/web-core/locales';

import type { CdnDeployment } from '@/shared/api-sdk';

import { CDN_RESOURCE_LABEL_KEY } from '../../../constants';
import { Section } from './Section';

interface DeploymentSectionProps {
  deployment: CdnDeployment;
}

/** 環境變數的唯讀資訊：能力、上限與預設值（docs/architecture/backend/09-file.md §16.9）。金鑰本身不顯示，只有 kid。 */
export function DeploymentSection({ deployment }: DeploymentSectionProps) {
  const { t } = useTranslation();
  if (!deployment.deployed) {
    return (
      <Section title={t('cdn.deployment.title')} data-testid="cdn-deployment">
        <p className="m-0 font-medium" data-testid="cdn-not-deployed">
          {t('cdn.deployment.notDeployed')}
        </p>
        <p className="m-0 text-sm text-[var(--color-fg-muted)]">
          {t('cdn.deployment.notDeployedHint')}
        </p>
      </Section>
    );
  }
  const onOff = (value: boolean) => (value ? t('cdn.deployment.on') : t('cdn.deployment.off'));
  const rows: Array<[string, string]> = [
    [t('cdn.deployment.provider'), deployment.provider ?? '—'],
    [t('cdn.deployment.origin'), deployment.origin ?? '—'],
    [t('cdn.deployment.signingKid'), deployment.signingKid ?? '—'],
    [t('cdn.deployment.kids'), deployment.kids.join(', ')],
    [
      t('cdn.deployment.resources'),
      deployment.resources.map((resource) => t(CDN_RESOURCE_LABEL_KEY[resource])).join(', '),
    ],
    [t('cdn.deployment.maxUrlTtl'), t('cdn.deployment.seconds', { count: deployment.maxUrlTtl })],
    [
      t('cdn.deployment.purge'),
      `${deployment.purgeConfigured ? t('cdn.deployment.purgeConfigured') : t('cdn.deployment.purgeNotConfigured')} · ${t(
        'cdn.deployment.defaults',
        { purgeOnDelete: onOff(deployment.purgeOnDelete), batch: deployment.purgeBatchSize },
      )}`,
    ],
    [
      t('cdn.deployment.healthCheck'),
      deployment.healthCheckCron ?? t('cdn.deployment.healthCheckOff'),
    ],
  ];
  return (
    <Section title={t('cdn.deployment.title')} data-testid="cdn-deployment">
      <dl className="m-0 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-[var(--color-fg-muted)]">{label}</dt>
            <dd className="m-0 break-all">{value}</dd>
          </div>
        ))}
      </dl>
    </Section>
  );
}
