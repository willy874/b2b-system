import { Button } from '@b2b-system/ui/Button';
import { Chip } from '@b2b-system/ui/Chip';
import { useErrorToast } from '@b2b-system/web-core/errors';
import { useTranslation } from '@b2b-system/web-core/locales';
import { formatDateTime } from '@b2b-system/web-shared/date';

import type { CdnCheckResult } from '@/shared/api-sdk';

import {
  CDN_NODE_PROBLEM_LABEL_KEY,
  CDN_PUBLIC_URL_LABEL_KEY,
  CDN_SIGNATURE_CHECK_LABEL_KEY,
  CDN_WARNING_PROBLEMS,
} from '../../../constants';
import { useCheckCdnMutation } from '../../../hooks/useCheckCdnMutation';
import { NodeProblemList } from './NodeProblemList';
import { Section } from './Section';

interface NodesSectionProps {
  lastCheck: CdnCheckResult | null;
}

/**
 * 邊緣節點（docs/architecture/backend/09-file.md §16.10）：最近一次檢查（定期的 `cdn.healthCheck` 或手動）的每個節點與五個項目。
 * 「執行檢查」只要 `cdn:read`：檢查是唯讀的，值班的人都要能確認狀態。
 */
export function NodesSection({ lastCheck }: NodesSectionProps) {
  const { t } = useTranslation();
  const showError = useErrorToast();
  const check = useCheckCdnMutation();

  return (
    <Section
      title={t('cdn.nodes.title')}
      description={
        lastCheck
          ? t('cdn.nodes.checkedAt', { time: formatDateTime(lastCheck.checkedAt) })
          : t('cdn.nodes.never')
      }
      actions={
        <Button
          size="sm"
          loading={check.isPending}
          onClick={() => check.mutate({ params: undefined }, { onError: showError })}
          data-testid="cdn-check"
        >
          {t('cdn.nodes.check')}
        </Button>
      }
      data-testid="cdn-nodes"
    >
      {lastCheck && (
        <>
          <Chip
            tone={lastCheck.ready ? 'success' : 'danger'}
            className="self-start"
            data-testid="cdn-check-ready"
            data-value={String(lastCheck.ready)}
          >
            {lastCheck.ready ? t('cdn.nodes.ready') : t('cdn.nodes.notReady')}
          </Chip>
          {!lastCheck.discovery.ok && (
            <NodeProblemList nodes={[]} discovery={lastCheck.discovery} />
          )}
          {lastCheck.nodes.length > 0 && (
            <div className="overflow-x-auto">
              <table
                className="w-full border-collapse text-left text-sm"
                data-testid="cdn-node-table"
              >
                <thead>
                  <tr className="text-[var(--color-fg-muted)]">
                    <th className="py-1 pr-3 font-normal">{t('cdn.nodes.address')}</th>
                    <th className="py-1 pr-3 font-normal">{t('cdn.nodes.status')}</th>
                    <th className="py-1 pr-3 font-normal">{t('cdn.nodes.kids')}</th>
                    <th className="py-1 pr-3 font-normal">{t('cdn.nodes.cache')}</th>
                    <th className="py-1 pr-3 font-normal">{t('cdn.nodes.build')}</th>
                    <th className="py-1 font-normal">{t('cdn.nodes.startedAt')}</th>
                  </tr>
                </thead>
                <tbody>
                  {lastCheck.nodes.map((node) => (
                    <tr
                      key={node.address}
                      className="border-t border-[var(--color-border)]"
                      data-testid="cdn-node"
                      data-value={node.address}
                    >
                      <td className="py-1 pr-3 font-mono">{node.address}</td>
                      <td className="py-1 pr-3">
                        <span className="flex flex-wrap gap-1">
                          {node.problems.length === 0 ? (
                            <Chip tone="success">{t('cdn.nodes.healthy')}</Chip>
                          ) : (
                            node.problems.map((problem) => (
                              <Chip
                                key={problem}
                                tone={CDN_WARNING_PROBLEMS.has(problem) ? 'warning' : 'danger'}
                                data-testid="cdn-node-status"
                                data-value={problem}
                              >
                                {t(CDN_NODE_PROBLEM_LABEL_KEY[problem])}
                              </Chip>
                            ))
                          )}
                        </span>
                      </td>
                      <td className="py-1 pr-3 font-mono">
                        {node.kids?.join(', ') ?? '—'}
                        {node.missingKids.length > 0 && (
                          <span className="block text-xs text-[var(--color-warning-text)]">
                            {t('cdn.nodes.missingKids', { kids: node.missingKids.join(', ') })}
                          </span>
                        )}
                      </td>
                      <td className="py-1 pr-3">
                        {node.cache ? t('cdn.nodes.cacheValue', node.cache) : '—'}
                      </td>
                      <td className="py-1 pr-3 font-mono">{node.build ?? '—'}</td>
                      <td className="py-1">
                        {node.startedAt ? formatDateTime(node.startedAt) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <dl className="m-0 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-[var(--color-fg-muted)]">{t('cdn.nodes.publicUrl')}</dt>
            <dd
              className="m-0"
              data-testid="cdn-public-url"
              data-value={lastCheck.publicUrl.result}
            >
              {t(CDN_PUBLIC_URL_LABEL_KEY[lastCheck.publicUrl.result])}
            </dd>
            <dt className="text-[var(--color-fg-muted)]">{t('cdn.nodes.signatureEnforced')}</dt>
            <dd
              className="m-0"
              data-testid="cdn-signature-enforced"
              data-value={lastCheck.signatureEnforced.result}
            >
              {t(CDN_SIGNATURE_CHECK_LABEL_KEY[lastCheck.signatureEnforced.result])}
            </dd>
          </dl>
        </>
      )}
    </Section>
  );
}
