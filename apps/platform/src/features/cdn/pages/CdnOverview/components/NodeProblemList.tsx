import { Chip } from '@b2b-system/ui/Chip';
import { useTranslation } from '@b2b-system/web-core/locales';

import type { CdnCheckNode, CdnCheckResult } from '@/shared/api-sdk';

import {
  CDN_DISCOVERY_PROBLEM_LABEL_KEY,
  CDN_NODE_PROBLEM_LABEL_KEY,
  CDN_WARNING_PROBLEMS,
} from '../../../constants';

interface NodeProblemListProps {
  nodes: ReadonlyArray<Pick<CdnCheckNode, 'address' | 'problems'>>;
  discovery?: CdnCheckResult['discovery'];
}

/** 每個節點的問題（開啟被拒時的 409 `details.nodes`、檢查的結果共用）。 */
export function NodeProblemList({ nodes, discovery }: NodeProblemListProps) {
  const { t } = useTranslation();
  return (
    <ul className="m-0 flex list-none flex-col gap-1 p-0 text-sm" data-testid="cdn-node-problems">
      {discovery?.problem && (
        <li data-testid="cdn-discovery-problem" data-value={discovery.problem}>
          {t(CDN_DISCOVERY_PROBLEM_LABEL_KEY[discovery.problem], {
            detail: discovery.detail ?? '',
          })}
        </li>
      )}
      {nodes
        .filter((node) => node.problems.length > 0)
        .map((node) => (
          <li
            key={node.address}
            className="flex flex-wrap items-center gap-2"
            data-testid="cdn-node-problem"
            data-value={node.address}
          >
            <code className="font-mono">{node.address}</code>
            {node.problems.map((problem) => (
              <Chip
                key={problem}
                tone={CDN_WARNING_PROBLEMS.has(problem) ? 'warning' : 'danger'}
                data-testid="cdn-node-problem-item"
                data-value={problem}
              >
                {t(CDN_NODE_PROBLEM_LABEL_KEY[problem])}
              </Chip>
            ))}
          </li>
        ))}
    </ul>
  );
}
