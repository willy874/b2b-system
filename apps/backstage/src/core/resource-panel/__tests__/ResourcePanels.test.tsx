import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { registerResourcePanel, resetResourcePanelRegistry } from '../registry';
import type { ResourcePanelProps } from '../registry';
import { ResourcePanels } from '../ResourcePanels';

function panel(name: string) {
  return function Panel({ resourceType, resourceId }: ResourcePanelProps) {
    return (
      <p data-testid="panel" data-value={name}>
        {resourceType}:{resourceId}
      </p>
    );
  };
}

beforeEach(() => {
  resetResourcePanelRegistry();
});

describe('ResourcePanels（docs/architecture/frontend/22-comment.md §2）', () => {
  it('只列出適用於這個資源類型的面板，依 order 排序，並收到資源', () => {
    registerResourcePanel({ id: 'b', order: 200, resourceTypes: ['user'], Panel: panel('b') });
    registerResourcePanel({ id: 'a', order: 100, resourceTypes: ['user'], Panel: panel('a') });
    registerResourcePanel({ id: 'file', order: 50, resourceTypes: ['file'], Panel: panel('file') });
    render(<ResourcePanels resourceType="user" resourceId="u1" />);
    const panels = screen.getAllByTestId('panel');
    expect(panels.map((element) => element.getAttribute('data-value'))).toEqual(['a', 'b']);
    expect(panels[0]).toHaveTextContent('user:u1');
  });

  it('feature 卸載（反註冊）後面板消失；同一個 id 重複登記丟例外', () => {
    const dispose = registerResourcePanel({
      id: 'a',
      order: 100,
      resourceTypes: ['user'],
      Panel: panel('a'),
    });
    expect(() =>
      registerResourcePanel({ id: 'a', order: 1, resourceTypes: ['user'], Panel: panel('x') }),
    ).toThrow('already registered');
    const { rerender } = render(<ResourcePanels resourceType="user" resourceId="u1" />);
    expect(screen.getByTestId('panel')).toBeInTheDocument();
    dispose();
    rerender(<ResourcePanels resourceType="user" resourceId="u1" />);
    expect(screen.queryByTestId('panel')).not.toBeInTheDocument();
  });
});
