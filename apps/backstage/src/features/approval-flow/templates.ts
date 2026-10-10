import { createStep } from './hooks/flowDraft';
import type { AssigneeDraft, FlowDraft } from './hooks/flowDraft';
import type { AssigneeKindAvailability } from './hooks/useAssigneeKindAvailability';

/**
 * 流程的範本（docs/architecture/backend/20-approval.md §9.16、§12 D6）：第一次設定流程時不必面對空白表單。
 * 範本只是產生草稿的前端常數，不是資料；需要指定對象的關卡（使用者、角色）在草稿裡留空，由使用者選。
 */
export const FLOW_TEMPLATE_IDS = [
  'manager',
  'managerThenRole',
  'role',
  'reviewThenApprove',
  'blank',
] as const;
export type FlowTemplateId = (typeof FLOW_TEMPLATE_IDS)[number];

interface TemplateStep {
  /** 關卡名稱的語系鍵：產生草稿時翻成目前的語言，之後可以改。 */
  nameKey: string;
  assignee: AssigneeDraft;
}

export interface FlowTemplate {
  id: FlowTemplateId;
  labelKey: string;
  descriptionKey: string;
  steps: readonly TemplateStep[];
}

const MANAGER: AssigneeDraft = { kind: 'manager', targetId: null, level: 1 };
const ROLE: AssigneeDraft = { kind: 'role', targetId: null, level: 1 };
const USER: AssigneeDraft = { kind: 'user', targetId: null, level: 1 };

export const FLOW_TEMPLATES: readonly FlowTemplate[] = [
  {
    id: 'manager',
    labelKey: 'approvalFlow.template.manager.label',
    descriptionKey: 'approvalFlow.template.manager.description',
    steps: [{ nameKey: 'approvalFlow.template.stepName.manager', assignee: MANAGER }],
  },
  {
    id: 'managerThenRole',
    labelKey: 'approvalFlow.template.managerThenRole.label',
    descriptionKey: 'approvalFlow.template.managerThenRole.description',
    steps: [
      { nameKey: 'approvalFlow.template.stepName.manager', assignee: MANAGER },
      { nameKey: 'approvalFlow.template.stepName.final', assignee: ROLE },
    ],
  },
  {
    id: 'role',
    labelKey: 'approvalFlow.template.role.label',
    descriptionKey: 'approvalFlow.template.role.description',
    steps: [{ nameKey: 'approvalFlow.template.stepName.review', assignee: ROLE }],
  },
  {
    id: 'reviewThenApprove',
    labelKey: 'approvalFlow.template.reviewThenApprove.label',
    descriptionKey: 'approvalFlow.template.reviewThenApprove.description',
    steps: [
      { nameKey: 'approvalFlow.template.stepName.first', assignee: USER },
      { nameKey: 'approvalFlow.template.stepName.final', assignee: ROLE },
    ],
  },
  {
    id: 'blank',
    labelKey: 'approvalFlow.template.blank.label',
    descriptionKey: 'approvalFlow.template.blank.description',
    steps: [],
  },
];

/**
 * 這個類型現在能用的範本：匿名的申請（註冊）沒有申請人，不能找主管；用到不能用的規則種類（組織管理、群組沒有啟用）時也不列。
 */
export function availableTemplates(
  isAnonymous: boolean,
  availability: AssigneeKindAvailability,
): FlowTemplate[] {
  return FLOW_TEMPLATES.filter((template) =>
    template.steps.every(
      ({ assignee }) =>
        availability[assignee.kind] && !(isAnonymous && assignee.kind === 'manager'),
    ),
  );
}

/** 範本 → 草稿（啟用、預設不允許同一個人審兩關）。「從空白開始」是一個空白的關卡。 */
export function draftFromTemplate(
  template: FlowTemplate,
  translate: (key: string) => string,
): FlowDraft {
  const steps = template.steps.length
    ? template.steps.map(({ nameKey, assignee }) => ({
        ...createStep(),
        name: translate(nameKey),
        assignee,
      }))
    : [createStep()];
  return { enabled: true, allowRepeatApprover: false, steps };
}
