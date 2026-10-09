import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import { createElement } from 'react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import type { ApprovalConditionField } from '@/shared/api-sdk';

import { exampleInputs, toFieldValues, useFlowPreview } from '../useFlowPreview';

const FIELDS: ApprovalConditionField[] = [
  { key: 'amount', type: 'number', options: null, example: 80000 },
  { key: 'emailDomain', type: 'string', options: null, example: 'example.com' },
  { key: 'category', type: 'enum', options: ['it'], example: null },
];

describe('試算的輸入（docs/architecture/backend/20-approval.md §9.16）', () => {
  it('欄位的範例值當成預設輸入；沒有範例的留空', () => {
    expect(exampleInputs(FIELDS)).toEqual({ amount: '80000', emailDomain: 'example.com' });
  });

  it('輸入 → 試算的值：數字轉數字、格式不對或空白當成沒填', () => {
    expect(toFieldValues(FIELDS, { amount: 'abc', emailDomain: ' a.com ', category: '' })).toEqual({
      amount: null,
      emailDomain: 'a.com',
      category: null,
    });
    expect(toFieldValues(FIELDS, { amount: '30000' })).toMatchObject({ amount: 30000 });
  });
});

describe('useFlowPreview（欄位定義晚一步到）', () => {
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: new QueryClient() }, children);

  it('流程還在載入（每次 render 都是新的空陣列）不會無限重繪；欄位到了才填入範例值', () => {
    const { result, rerender } = renderHook(
      ({ fields }: { fields: ApprovalConditionField[] | undefined }) =>
        // 與頁面早期的寫法相同：每次 render 都是新的空陣列
        useFlowPreview({ type: 't', draft: undefined, fields: fields ?? [], isAnonymous: true }),
      { wrapper, initialProps: { fields: undefined as ApprovalConditionField[] | undefined } },
    );
    // 頁面因其他原因重繪（查詢狀態改變）
    rerender({ fields: undefined });
    expect(result.current.inputs).toEqual({});
    rerender({ fields: FIELDS });
    expect(result.current.inputs).toEqual({ amount: '80000', emailDomain: 'example.com' });
  });
});
