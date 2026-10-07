import { AllProviders } from '@b2b-system/web-core/testing';
import { render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it } from 'vitest';

import type { ExplainNode } from '@/shared/api-sdk';
import { initTestI18n } from '@/test/i18n';

import { ExplainPath } from './ExplainPath';

beforeAll(() => initTestI18n());

const node = (partial: Partial<ExplainNode> & Pick<ExplainNode, 'type'>): ExplainNode => ({
  id: 'x',
  relation: '',
  name: null,
  hidden: false,
  ...partial,
});

describe('ExplainPath（docs/architecture/iam/01-model.md §9 G4b、D14）', () => {
  it('依序顯示節點：名稱、資料夾的等級與動作、權限鍵', () => {
    render(
      <ExplainPath
        nodes={[
          node({ type: 'user', name: 'Alice' }),
          node({ type: 'group', relation: 'member', name: '美術' }),
          node({ type: 'fileFolder', relation: 'viewer', name: '素材' }),
          node({ type: 'tenant', id: 'self', relation: 'file:read' }),
        ]}
      />,
      { wrapper: AllProviders },
    );
    const nodes = screen.getAllByTestId('explain-node');
    expect(nodes.map((item) => item.textContent)).toEqual([
      'Alice',
      '美術',
      '素材（檢視者）',
      'file:read',
    ]);
  });

  it('讀不到的節點只顯示種類；所有人顯示「所有人」', () => {
    render(
      <ExplainPath
        nodes={[
          node({ type: 'user', id: '*' }),
          node({ type: 'group', id: null, relation: 'member', hidden: true }),
          node({ type: 'role', id: null, relation: 'holder', hidden: true }),
        ]}
      />,
      { wrapper: AllProviders },
    );
    const nodes = screen.getAllByTestId('explain-node');
    expect(nodes.map((item) => item.textContent)).toEqual(['所有人', '某個群組', '某個角色']);
    expect(nodes[1]).toHaveAttribute('data-hidden', 'true');
  });
});
