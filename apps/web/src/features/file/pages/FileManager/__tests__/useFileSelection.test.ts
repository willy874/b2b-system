import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useFileSelection } from '../useFileSelection';

const IDS = ['a', 'b', 'c', 'd', 'e'];
const selected = (result: { current: ReturnType<typeof useFileSelection> }) =>
  [...result.current.selected].toSorted();

describe('useFileSelection（仿檔案總管的多選）', () => {
  it('點擊只選一個；Ctrl / ⌘ 點擊切換', () => {
    const { result } = renderHook(() => useFileSelection(IDS));
    act(() => result.current.click('a'));
    act(() => result.current.click('c'));
    expect(selected(result)).toEqual(['c']);
    act(() => result.current.click('d', { toggle: true }));
    act(() => result.current.click('c', { toggle: true }));
    expect(selected(result)).toEqual(['d']);
  });

  it('Shift 點擊：從錨點選到這一個（兩個方向都行）', () => {
    const { result } = renderHook(() => useFileSelection(IDS));
    act(() => result.current.click('d'));
    act(() => result.current.click('b', { shift: true }));
    expect(selected(result)).toEqual(['b', 'c', 'd']);
  });

  it('框選：replace 取代；add 疊加在開始時的選取上', () => {
    const { result } = renderHook(() => useFileSelection(IDS));
    act(() => result.current.apply(['a', 'b'], 'replace'));
    const base = result.current.selected;
    act(() => result.current.apply(['d'], 'add', base));
    expect(selected(result)).toEqual(['a', 'b', 'd']);
    act(() => result.current.apply(['e'], 'replace'));
    expect(selected(result)).toEqual(['e']);
  });

  it('資料更新後不在畫面上的項目自動移出選取（例：被別人刪除）', () => {
    const { result, rerender } = renderHook(({ ids }) => useFileSelection(ids), {
      initialProps: { ids: IDS },
    });
    act(() => result.current.selectAll());
    rerender({ ids: ['a', 'c'] });
    expect(selected(result)).toEqual(['a', 'c']);
  });
});
