import { useEffect, useState } from 'react';

import type { ApprovalConditionField, PreviewApprovalFlowRequest } from '@/shared/api-sdk';

import { toStepInputs } from '../../hooks/flowDraft';
import type { FlowDraft } from '../../hooks/flowDraft';
import { useApprovalFlowPreviewMutation } from '../../hooks/useApprovalFlowMutations';

/** 草稿停止變動多久之後自動試算。 */
export const PREVIEW_DEBOUNCE_MS = 500;

/** 欄位的輸入 → 試算的值：數字欄位轉數字（格式不對當成沒填），空白當成沒填（條件不成立）。 */
export function toFieldValues(
  fields: readonly ApprovalConditionField[],
  inputs: Readonly<Record<string, string>>,
): PreviewApprovalFlowRequest['fields'] {
  const values: PreviewApprovalFlowRequest['fields'] = {};
  for (const field of fields) {
    const text = inputs[field.key]?.trim() ?? '';
    if (!text) values[field.key] = null;
    else if (field.type === 'number') {
      const number = Number(text);
      values[field.key] = Number.isFinite(number) ? number : null;
    } else values[field.key] = text;
  }
  return values;
}

/** 欄位的範例值（handler 宣告的 `example`）當成試算的預設輸入。 */
export function exampleInputs(fields: readonly ApprovalConditionField[]): Record<string, string> {
  return Object.fromEntries(
    fields.flatMap((field) => (field.example === null ? [] : [[field.key, String(field.example)]])),
  );
}

/**
 * 試算的狀態（docs/architecture/backend/20-approval.md §9.16）：草稿、申請人或欄位值變動後停 500ms 自動試算；
 * 草稿不完整時不送（`incomplete`）。結果只在對應「目前的」草稿時回傳，流程摘要據此標示略過與短缺。
 */
export function useFlowPreview({
  type,
  draft,
  fields,
  isAnonymous,
}: {
  type: string;
  draft: FlowDraft | undefined;
  fields: readonly ApprovalConditionField[];
  isAnonymous: boolean;
}) {
  const preview = useApprovalFlowPreviewMutation();
  const { mutate } = preview;
  const [requesterId, setRequesterId] = useState<string | null>(null);
  const [inputs, setInputs] = useState<Record<string, string>>(() => exampleInputs(fields));
  // 欄位定義晚一步到（流程還在載入）：到的時候填入範例值（render 期間調整 state，不經過 effect）
  const [seededFor, setSeededFor] = useState(fields);
  if (seededFor.length === 0 && fields.length > 0) {
    setSeededFor(fields);
    setInputs(exampleInputs(fields));
  }

  const steps = draft ? toStepInputs(draft.steps, fields) : null;
  const body: PreviewApprovalFlowRequest | null =
    draft && steps
      ? {
          steps,
          allowRepeatApprover: draft.allowRepeatApprover,
          requesterId: isAnonymous ? null : requesterId,
          fields: toFieldValues(fields, inputs),
        }
      : null;
  const bodyKey = body ? JSON.stringify(body) : null;

  useEffect(() => {
    if (!bodyKey) return undefined;
    const timer = setTimeout(
      () => mutate({ params: { type, body: JSON.parse(bodyKey) as PreviewApprovalFlowRequest } }),
      PREVIEW_DEBOUNCE_MS,
    );
    return () => clearTimeout(timer);
  }, [bodyKey, mutate, type]);

  const isCurrent =
    bodyKey !== null &&
    preview.variables !== undefined &&
    JSON.stringify(preview.variables.params.body) === bodyKey;

  return {
    requesterId,
    setRequesterId,
    inputs,
    setInput: (key: string, value: string) =>
      setInputs((current) => ({ ...current, [key]: value })),
    /** 草稿還有沒填完的關卡：不試算。 */
    incomplete: body === null,
    /** 對應目前草稿的結果；草稿改了、還沒重新試算完時為 undefined。 */
    result: isCurrent ? preview.data : undefined,
    error: isCurrent ? preview.error : null,
    isPending: preview.isPending,
    /** 立即重新試算（換了申請人之後不想等）。 */
    run: () => {
      if (body) mutate({ params: { type, body } });
    },
  };
}

export type FlowPreviewState = ReturnType<typeof useFlowPreview>;
