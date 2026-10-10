import { describe, expect, it } from 'vitest';

import type { AssigneeKindAvailability } from '../hooks/useAssigneeKindAvailability';
import { availableTemplates, draftFromTemplate, FLOW_TEMPLATES } from '../templates';

const ALL: AssigneeKindAvailability = {
  user: true,
  group: true,
  role: true,
  manager: true,
  orgUnit: true,
};
const ids = (templates: ReturnType<typeof availableTemplates>) => templates.map(({ id }) => id);

describe('流程範本（docs/architecture/backend/20-approval.md §9.16、§12 D6）', () => {
  it('登入者的申請：全部的範本', () => {
    expect(ids(availableTemplates(false, ALL))).toEqual(FLOW_TEMPLATES.map(({ id }) => id));
  });

  it('匿名的申請（註冊）：沒有申請人可以找主管', () => {
    expect(ids(availableTemplates(true, ALL))).toEqual(['role', 'reviewThenApprove', 'blank']);
  });

  it('組織管理未啟用：主管的範本不列出', () => {
    expect(
      ids(availableTemplates(false, { ...ALL, manager: false, orgUnit: false })),
    ).not.toContain('manager');
  });

  it('範本 → 草稿：啟用、關卡名稱翻成目前的語言、需要指定的對象留空、還沒有 key（新的關卡）', () => {
    const template = FLOW_TEMPLATES.find(({ id }) => id === 'managerThenRole')!;
    const draft = draftFromTemplate(template, (key) => `「${key}」`);
    expect(draft).toMatchObject({ enabled: true, allowRepeatApprover: false });
    expect(draft.steps.map((step) => [step.name, step.assignee, step.key])).toEqual([
      [
        '「approvalFlow.template.stepName.manager」',
        { kind: 'manager', targetId: null, level: 1 },
        undefined,
      ],
      [
        '「approvalFlow.template.stepName.final」',
        { kind: 'role', targetId: null, level: 1 },
        undefined,
      ],
    ]);
  });

  it('從空白開始：一個空白的關卡', () => {
    const draft = draftFromTemplate(
      FLOW_TEMPLATES.find(({ id }) => id === 'blank')!,
      String,
    );
    expect(draft.steps).toHaveLength(1);
    expect(draft.steps[0]?.name).toBe('');
  });
});
