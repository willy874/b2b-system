import { Button } from '@b2b-system/ui/Button';
import { Chip } from '@b2b-system/ui/Chip';
import { Icon } from '@b2b-system/ui/Icon';
import { formatDateTime } from '@b2b-system/web-shared/date';
import type { ReactNode } from 'react';

import { useTranslation } from '../../locales';
import { useMfaMethodUis } from '../registry';
import type { MfaFactorView } from '../types';

export interface FactorListProps {
  factors: readonly MfaFactorView[];
  /** 每一列右側的動作（自助的「移除」）；沒有時不顯示。 */
  renderAction?: (factor: MfaFactorView) => ReactNode;
  empty?: ReactNode;
  'data-testid'?: string;
}

/**
 * 已設定的驗證方式。伺服器回傳沒有登記的方式（例：api 先部署了新方式）時顯示「這個版本不支援」，不讓畫面壞掉；
 * 方式目前被關掉時註明「目前無法使用」（docs/architecture/backend/21-mfa.md §11）。
 */
export function FactorList({ factors, renderAction, empty, ...rest }: FactorListProps) {
  const { t } = useTranslation();
  const methods = useMfaMethodUis();
  if (factors.length === 0) return <>{empty}</>;
  return (
    <ul
      className="m-0 flex list-none flex-col gap-2 p-0"
      data-testid={rest['data-testid'] ?? 'mfa-factor-list'}
    >
      {factors.map((factor) => {
        const method = methods.get(factor.method);
        return (
          <li
            key={factor.id}
            className="flex items-center gap-3 rounded border border-[var(--color-border)] p-3"
            data-testid="mfa-factor"
            data-value={factor.method}
          >
            <Icon name={method?.icon ?? 'shield'} size={20} />
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="text-sm font-medium">
                {method ? t(method.labelKey) : factor.method}
                {factor.label && <span className="ml-2 font-normal">{factor.label}</span>}
              </span>
              <span className="text-xs text-[var(--color-fg-muted)]">
                {[
                  factor.hint,
                  t('mfa.factor.added', { time: formatDateTime(factor.createdAt) }),
                  factor.lastUsedAt
                    ? t('mfa.factor.lastUsed', { time: formatDateTime(factor.lastUsedAt) })
                    : t('mfa.factor.neverUsed'),
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </div>
            {!method && <Chip tone="warning">{t('mfa.factor.unsupported')}</Chip>}
            {method && !factor.available && <Chip tone="warning">{t('mfa.factor.disabled')}</Chip>}
            {renderAction?.(factor)}
          </li>
        );
      })}
    </ul>
  );
}

/** 列表上「移除」之類的小按鈕。 */
export function FactorActionButton(props: {
  onClick: () => void;
  children: ReactNode;
  'data-testid'?: string;
}) {
  return (
    <Button size="sm" variant="ghost" onClick={props.onClick} data-testid={props['data-testid']}>
      {props.children}
    </Button>
  );
}
