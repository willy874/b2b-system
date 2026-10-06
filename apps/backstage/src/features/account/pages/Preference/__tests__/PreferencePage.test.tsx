import {
  registerPreferenceSection,
  resetPreferenceRegistry,
} from '@b2b-system/web-core/preference';
import { renderRoute } from '@b2b-system/web-core/testing';
import { screen, within } from '@testing-library/react';
import { lazy } from 'react';
import type { ComponentType } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { initTestI18n } from '@/test/i18n';

import { Routes } from '../../..';
import accountZhTW from '../../../locales/zh_TW.json';

/** 由測試決定 lazy 元件的 chunk 何時「下載完成」 */
function deferredModule() {
  const handle: { done?: (module: { default: ComponentType }) => void } = {};
  const promise = new Promise<{ default: ComponentType }>((done) => {
    handle.done = done;
  });
  return { promise, resolve: (component: ComponentType) => handle.done?.({ default: component }) };
}

async function findSection(key: string): Promise<HTMLElement> {
  const sections = await screen.findAllByTestId('preference-section');
  const section = sections.find((element) => element.dataset.value === key);
  if (!section) throw new Error(`找不到 preference-section（data-value="${key}"）`);
  return section;
}

beforeAll(() => initTestI18n(accountZhTW));

beforeEach(() => {
  resetPreferenceRegistry();
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('PreferencePage 的分頁（docs/architecture/frontend/02-plugin-system.md §4.3）', () => {
  it('lazy 登記的分頁先顯示骨架，載入後換成分頁內容', async () => {
    const chunk = deferredModule();
    registerPreferenceSection({
      key: 'lazy-section',
      order: 100,
      labelI18nKey: 'lazySection.title',
      Component: lazy(() => chunk.promise),
    });
    renderRoute([Routes.PreferenceRoute], '/preference', []);

    const section = await findSection('lazy-section');
    expect(within(section).getByTestId('preference-section-skeleton')).toBeInTheDocument();

    chunk.resolve(() => <p>分頁內容</p>);
    expect(await within(section).findByText('分頁內容')).toBeInTheDocument();
    expect(within(section).queryByTestId('preference-section-skeleton')).not.toBeInTheDocument();
  });
});
