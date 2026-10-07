import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { BrowserItemVM } from '../adapter';
import { useFileDialogs } from '../useFileDialogs';

const FOLDER = { id: 'f1', name: '報表' };

describe('useFileDialogs（共用、申請存取、標籤對話框的對象）', () => {
  it('有對象才開；關閉清空', () => {
    const { result } = renderHook(() => useFileDialogs());
    act(() => {
      result.current.share(undefined);
      result.current.requestAccess(undefined);
    });
    expect(result.current.shareTarget).toBeUndefined();
    expect(result.current.requestTarget).toBeUndefined();

    act(() => result.current.share(FOLDER));
    expect(result.current.shareTarget).toEqual(FOLDER);
    act(() => result.current.closeShare());
    expect(result.current.shareTarget).toBeUndefined();

    act(() => result.current.requestAccess(FOLDER));
    expect(result.current.requestTarget).toEqual(FOLDER);
    act(() => result.current.closeRequest());
    expect(result.current.requestTarget).toBeUndefined();
  });

  it('標籤的對象是選取的項目', () => {
    const item = { id: 'a', name: 'a.png', type: 'file' } as BrowserItemVM;
    const { result } = renderHook(() => useFileDialogs());
    act(() => result.current.tag(item));
    expect(result.current.tagTarget).toBe(item);
    act(() => result.current.closeTag());
    expect(result.current.tagTarget).toBeUndefined();
  });
});
