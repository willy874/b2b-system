import { useState } from 'react';

import { hasErrorAt } from '../../hooks/flowDraft';
import type { StepDraft } from '../../hooks/flowDraft';

/**
 * 關卡卡片的展開與收合（docs/architecture/backend/20-approval.md §9.16）：還沒儲存過的關卡（範本、新增的）預設展開，
 * 已儲存的收合成一行；有錯誤的一律展開。使用者手動切換過的照他的選擇。
 */
export function useStepExpansion(
  errors: Readonly<Record<string, string>>,
  rejectedSteps: ReadonlySet<number>,
) {
  const [toggled, setToggled] = useState<ReadonlyMap<string, boolean>>(new Map());

  const isExpanded = (step: StepDraft, index: number) =>
    hasErrorAt(errors, `steps.${index}`) ||
    rejectedSteps.has(index) ||
    (toggled.get(step.id) ?? step.key === undefined);

  const set = (stepId: string, expanded: boolean) =>
    setToggled((current) => new Map(current).set(stepId, expanded));

  return {
    isExpanded,
    toggle: (step: StepDraft, index: number) => set(step.id, !isExpanded(step, index)),
    /** 展開並捲到這一關（流程摘要點節點時）。 */
    reveal: (stepId: string, elementId: string) => {
      set(stepId, true);
      // 等展開的卡片渲染後再捲過去
      requestAnimationFrame(() =>
        document.getElementById(elementId)?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
      );
    },
    reset: () => setToggled(new Map()),
  };
}
