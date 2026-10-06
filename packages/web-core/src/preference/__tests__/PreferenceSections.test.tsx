import { render, screen, within } from '@testing-library/react';
import { act, lazy } from 'react';
import type { ComponentType } from 'react';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { initTestI18n } from '../../testing/i18n';
import { PreferenceSections } from '../PreferenceSections';
import { registerPreferenceSection, resetPreferenceRegistry } from '../registry';

function deferredModule() {
  const handle: { done?: (module: { default: ComponentType }) => void } = {};
  const promise = new Promise<{ default: ComponentType }>((done) => {
    handle.done = done;
  });
  return { promise, resolve: (component: ComponentType) => handle.done?.({ default: component }) };
}

function section(key: string): HTMLElement {
  const found = screen
    .getAllByTestId('preference-section')
    .find((element) => element.dataset.value === key);
  if (!found) throw new Error(`找不到 preference-section（data-value="${key}"）`);
  return found;
}

describe('PreferenceSections（偏好頁的分頁；docs/architecture/frontend/02-plugin-system.md §4.3）', () => {
  beforeAll(() => initTestI18n());
  beforeEach(() => resetPreferenceRegistry());

  it('依 order 排列；下載中的 lazy 分頁顯示骨架，不擋住其他分頁', async () => {
    const chunk = deferredModule();
    registerPreferenceSection({
      key: 'plain',
      order: 200,
      labelI18nKey: 'plain.title',
      Component: () => <p>一般分頁</p>,
    });
    registerPreferenceSection({
      key: 'lazy',
      order: 100,
      labelI18nKey: 'lazy.title',
      Component: lazy(() => chunk.promise),
    });
    render(<PreferenceSections />);

    expect(
      screen.getAllByTestId('preference-section').map((element) => element.dataset.value),
    ).toEqual(['lazy', 'plain']);
    expect(within(section('plain')).getByText('一般分頁')).toBeInTheDocument();
    expect(within(section('lazy')).getByTestId('preference-section-skeleton')).toBeInTheDocument();

    await act(async () => chunk.resolve(() => <p>延遲載入的分頁</p>));
    expect(await within(section('lazy')).findByText('延遲載入的分頁')).toBeInTheDocument();
    expect(
      within(section('lazy')).queryByTestId('preference-section-skeleton'),
    ).not.toBeInTheDocument();
  });
});
