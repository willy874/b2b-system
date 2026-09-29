import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import zhTW from '@/app/locales/zh_TW.json';
import { i18n, initI18n } from '@/core/locales';

import { FilterBar } from './FilterBar';
import type { FilterBarProps, FilterField } from './index';

type Status = 'active' | 'locked';

type Values = {
  keyword?: string;
  status?: Status;
  statuses?: Status[];
  range?: { from?: string; to?: string };
};

const STATUS_OPTIONS: Array<{ value: Status; label: string }> = [
  { value: 'active', label: '啟用' },
  { value: 'locked', label: '鎖定' },
];

const FIELDS: Array<FilterField<Values>> = [
  { type: 'text', key: 'keyword', label: '關鍵字' },
  { type: 'select', key: 'status', label: '狀態', allLabel: '全部狀態', options: STATUS_OPTIONS },
  { type: 'multiSelect', key: 'statuses', label: '多選狀態', options: STATUS_OPTIONS },
  { type: 'dateRange', key: 'range', label: '期間' },
];

const EMPTY: Values = {
  keyword: undefined,
  status: undefined,
  statuses: undefined,
  range: undefined,
};

function renderBar(overrides: Partial<FilterBarProps<Values>> = {}) {
  const props: FilterBarProps<Values> = {
    fields: FIELDS,
    value: EMPTY,
    onSubmit: vi.fn(),
    defaultValue: EMPTY,
    ...overrides,
  };
  const view = render(<FilterBar {...props} />);
  return {
    ...props,
    rerender: (next: Partial<FilterBarProps<Values>>) =>
      view.rerender(<FilterBar {...props} {...next} />),
  };
}

async function openPanel(): Promise<HTMLElement> {
  await userEvent.click(screen.getByTestId('filter-bar-trigger'));
  return screen.findByTestId('filter-bar-popup');
}

function fieldOf(key: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(
    `[data-testid="filter-bar-field"][data-value="${key}"]`,
  );
  if (!element) throw new Error(`找不到 filter-bar-field（data-value="${key}"）`);
  return element;
}

// 篩選按鈕只有圖示，名稱來自語系檔的 aria-label
beforeAll(async () => {
  await initI18n('zh-TW');
  i18n.addResourceBundle('zh-TW', 'translation', zhTW, true, true);
});

describe('FilterBar', () => {
  describe('篩選按鈕', () => {
    it('沒有欄位有值時不顯示數量', () => {
      renderBar();
      const trigger = screen.getByTestId('filter-bar-trigger');
      expect(trigger).not.toHaveAttribute('data-active');
      expect(trigger.textContent).not.toMatch(/\d/);
    });

    it('依目前生效的值顯示有篩選的欄位數量', () => {
      renderBar({ value: { ...EMPTY, keyword: 'alice', range: { from: '2026-09-01' } } });
      const trigger = screen.getByTestId('filter-bar-trigger');
      expect(trigger).toHaveAttribute('data-active');
      expect(trigger).toHaveTextContent('2');
    });

    it('只顯示圖示，以 aria-label 命名', () => {
      renderBar();
      expect(screen.getByTestId('filter-bar-trigger')).toHaveAccessibleName('篩選');
    });

    it('有篩選時 aria-label 帶數量', () => {
      renderBar({ value: { ...EMPTY, keyword: 'alice' } });
      expect(screen.getByTestId('filter-bar-trigger')).toHaveAccessibleName('篩選（1 個條件）');
    });

    it('點開後依序列出每個欄位', async () => {
      renderBar();
      const popup = await openPanel();
      const keys = [...popup.querySelectorAll<HTMLElement>('[data-testid="filter-bar-field"]')].map(
        (element) => element.dataset.value,
      );
      expect(keys).toEqual(['keyword', 'status', 'statuses', 'range']);
    });
  });

  describe('草稿與送出', () => {
    it('修改只改草稿，按「搜尋」才一次送出整份值並收合', async () => {
      const { onSubmit } = renderBar();
      await openPanel();

      await userEvent.type(screen.getByRole('textbox', { name: '關鍵字' }), 'alice');
      await userEvent.click(screen.getByRole('combobox', { name: '狀態' }));
      await userEvent.click(await screen.findByRole('option', { name: '鎖定' }));
      // Base UI 的 checkbox 在 jsdom 取不到無障礙名稱，改點選項文字（同 Checkbox.test.tsx）
      await userEvent.click(within(fieldOf('statuses')).getByText('啟用'));
      expect(onSubmit).not.toHaveBeenCalled();

      await userEvent.click(screen.getByTestId('filter-bar-submit'));
      expect(onSubmit).toHaveBeenCalledOnce();
      expect(onSubmit).toHaveBeenCalledWith({
        ...EMPTY,
        keyword: 'alice',
        status: 'locked',
        statuses: ['active'],
      });
      expect(screen.queryByTestId('filter-bar-popup')).not.toBeInTheDocument();
    });

    it('在文字欄位按 Enter 等同按「搜尋」，前後空白會去掉', async () => {
      const { onSubmit } = renderBar();
      await openPanel();
      await userEvent.type(screen.getByRole('textbox', { name: '關鍵字' }), '  alice {Enter}');
      expect(onSubmit).toHaveBeenCalledWith({ ...EMPTY, keyword: 'alice' });
    });

    it('只輸入空白視為沒有輸入', async () => {
      const { onSubmit } = renderBar();
      await openPanel();
      await userEvent.type(screen.getByRole('textbox', { name: '關鍵字' }), '   {Enter}');
      expect(onSubmit).toHaveBeenCalledWith(EMPTY);
    });

    it('關掉面板就放棄草稿，下次打開從目前生效的值開始', async () => {
      const { onSubmit } = renderBar({ value: { ...EMPTY, keyword: 'bob' } });
      await openPanel();
      const input = screen.getByRole('textbox', { name: '關鍵字' });
      await userEvent.clear(input);
      await userEvent.type(input, 'draft');
      await userEvent.keyboard('{Escape}');
      expect(onSubmit).not.toHaveBeenCalled();

      await openPanel();
      expect(screen.getByRole('textbox', { name: '關鍵字' })).toHaveValue('bob');
    });

    it('「清除」把草稿換成 defaultValue，仍要送出才生效', async () => {
      const { onSubmit } = renderBar({ value: { ...EMPTY, keyword: 'bob', status: 'active' } });
      await openPanel();
      await userEvent.click(screen.getByTestId('filter-bar-reset'));
      expect(screen.getByRole('textbox', { name: '關鍵字' })).toHaveValue('');
      expect(onSubmit).not.toHaveBeenCalled();

      await userEvent.click(screen.getByTestId('filter-bar-submit'));
      expect(onSubmit).toHaveBeenCalledWith(EMPTY);
    });

    it('沒有 defaultValue 時不顯示「清除」', async () => {
      renderBar({ defaultValue: undefined });
      await openPanel();
      expect(screen.queryByTestId('filter-bar-reset')).not.toBeInTheDocument();
    });
  });

  describe('各型別', () => {
    it('select 選「全部」寫回 undefined', async () => {
      const { onSubmit } = renderBar({ value: { ...EMPTY, status: 'locked' } });
      await openPanel();
      await userEvent.click(screen.getByRole('combobox', { name: '狀態' }));
      await userEvent.click(await screen.findByRole('option', { name: '全部狀態' }));
      await userEvent.click(screen.getByTestId('filter-bar-submit'));
      expect(onSubmit).toHaveBeenCalledWith(EMPTY);
    });

    it('multiSelect 全部取消時寫回 undefined', async () => {
      const { onSubmit } = renderBar({ value: { ...EMPTY, statuses: ['active'] } });
      await openPanel();
      await userEvent.click(within(fieldOf('statuses')).getByText('啟用'));
      await userEvent.click(screen.getByTestId('filter-bar-submit'));
      expect(onSubmit).toHaveBeenCalledWith(EMPTY);
    });

    it('dateRange 已有起點時再選一天，草稿變成完整區間', async () => {
      const { onSubmit } = renderBar({ value: { ...EMPTY, range: { from: '2026-09-01' } } });
      await openPanel();
      await userEvent.click(screen.getByTestId('filter-bar-date-range'));
      await screen.findByTestId('date-range-picker-calendar');
      const day = document.querySelector<HTMLElement>(
        '[data-testid="calendar-day"][data-value="2026-09-05"]',
      );
      if (!day) throw new Error('找不到 2026-09-05');
      await userEvent.click(day);
      await userEvent.click(screen.getByTestId('filter-bar-submit'));
      expect(onSubmit).toHaveBeenCalledWith({
        ...EMPTY,
        range: { from: '2026-09-01', to: '2026-09-05' },
      });
    });

    it('custom 以 render 的 value / onChange 讀寫草稿', async () => {
      type OwnerValues = { mine?: boolean };
      const onSubmit = vi.fn();
      render(
        <FilterBar<OwnerValues>
          value={{ mine: undefined }}
          onSubmit={onSubmit}
          fields={[
            {
              type: 'custom',
              key: 'mine',
              label: '負責人',
              render: ({ value, onChange }) => (
                <button type="button" onClick={() => onChange(!value)}>
                  只看我的
                </button>
              ),
            },
          ]}
        />,
      );
      await openPanel();
      await userEvent.click(screen.getByRole('button', { name: '只看我的' }));
      await userEvent.click(screen.getByTestId('filter-bar-submit'));
      expect(onSubmit).toHaveBeenCalledWith({ mine: true });
    });
  });

  describe('文字與 slot', () => {
    it('labels 覆寫「清除」「搜尋」的文字', async () => {
      renderBar({ labels: { reset: '重來', submit: '找' } });
      await openPanel();
      expect(screen.getByTestId('filter-bar-reset')).toHaveTextContent('重來');
      expect(screen.getByTestId('filter-bar-submit')).toHaveTextContent('找');
    });

    it('data-testid 落在按鈕，classNames / testIds 覆寫面板內層', async () => {
      renderBar({
        value: { ...EMPTY, status: 'active' },
        classNames: { field: 'custom-field' },
        testIds: { count: 'custom-count' },
        'data-testid': 'user-filter',
      });
      expect(screen.getByTestId('custom-count')).toHaveTextContent('1');

      await userEvent.click(screen.getByTestId('user-filter'));
      await screen.findByTestId('filter-bar-popup');
      expect(fieldOf('status')).toHaveClass('custom-field');
    });
  });
});
