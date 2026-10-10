import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { StaleItemTrigger } from '../components/StaleItemTrigger';

describe('StaleItemTrigger（捲到快照時通知）', () => {
  it('掛上時通知一次；資料改變（revision）後還在畫面上就再通知；其他重繪不通知', () => {
    const onVisible = vi.fn();
    const revision = {};
    const { rerender } = render(
      <StaleItemTrigger id="g1" revision={revision} onVisible={onVisible} />,
    );
    expect(onVisible).toHaveBeenCalledExactlyOnceWith('g1');

    rerender(<StaleItemTrigger id="g1" revision={revision} onVisible={vi.fn()} />);
    expect(onVisible).toHaveBeenCalledOnce();

    const latest = vi.fn();
    rerender(<StaleItemTrigger id="g1" revision={{}} onVisible={latest} />);
    expect(latest).toHaveBeenCalledExactlyOnceWith('g1');
  });
});
