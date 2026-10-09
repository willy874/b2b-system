import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { GalleryItem } from '@/shared/api-sdk';

import { useGallerySelection } from '../useGallerySelection';

const items = ['a', 'b', 'c', 'd'].map((id) => ({ id }) as GalleryItem);
const [a, b, c, d] = items as [GalleryItem, GalleryItem, GalleryItem, GalleryItem];

describe('useGallerySelection（docs/architecture/frontend/24-gallery.md §5）', () => {
  it('點一下切換；Shift 從上一個點的到這一個連續選取', () => {
    const { result } = renderHook(() => useGallerySelection(items));
    act(() => result.current.toggle(a));
    act(() => result.current.toggle(c, { shiftKey: true }));
    expect([...result.current.selected]).toEqual(['a', 'b', 'c']);
    act(() => result.current.toggle(b));
    expect([...result.current.selected].toSorted()).toEqual(['a', 'c']);
  });

  it('框選：取代或疊加；以區段全選；清空', () => {
    const { result } = renderHook(() => useGallerySelection(items));
    act(() => result.current.apply(['a'], 'replace', new Set()));
    act(() => result.current.apply(['d'], 'add', result.current.getSelected()));
    expect([...result.current.selected].toSorted()).toEqual(['a', 'd']);
    act(() => result.current.addAll(['b', 'c']));
    expect(result.current.selected.size).toBe(4);
    act(() => result.current.clear());
    expect(result.current.selected.size).toBe(0);
  });

  it('不在已載入列表裡的 id 不算進選取（被刪除、換了篩選）', () => {
    const { result, rerender } = renderHook(({ list }) => useGallerySelection(list), {
      initialProps: { list: items },
    });
    act(() => result.current.addAll(['a', 'd']));
    rerender({ list: [a, b, c] });
    expect([...result.current.selected]).toEqual(['a']);
    expect(d.id).toBe('d');
  });
});
