import { AllProviders } from '@b2b-system/web-core/testing';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { initTestI18n } from '@/test/i18n';

import announcementZhTW from '../../locales/zh_TW.json';
import { EMPTY_TRIGGER_DRAFT } from '../triggerDraft';
import type { TriggerDraft } from '../triggerDraft';
import { TriggerField } from '../TriggerField';

const { fetchEvents, fetchPreview } = vi.hoisted(() => ({
  fetchEvents: vi.fn(),
  fetchPreview: vi.fn(),
}));
vi.mock('@/apis/announcement/get-announcement-trigger-events/fetcher', () => ({
  fetchAnnouncementTriggerEventsQuery: fetchEvents,
}));
vi.mock('@/apis/announcement/preview-announcement-recurrence/fetcher', () => ({
  fetchAnnouncementRecurrencePreviewQuery: fetchPreview,
}));

const RECURRING: TriggerDraft = {
  ...EMPTY_TRIGGER_DRAFT,
  kind: 'recurring',
  frequency: 'weekly',
  weekdays: [1],
  startsOn: '2026-10-10',
};

/** 受控元件：以 state 接住 onChange，並記下每次送出的值。 */
function renderField(
  initial: TriggerDraft,
  props: { allowImmediate?: boolean; disabled?: boolean } = {},
) {
  const onChange = vi.fn();
  function Harness() {
    const [value, setValue] = useState(initial);
    return (
      <TriggerField
        value={value}
        onChange={(next) => {
          onChange(next);
          setValue(next);
        }}
        allowImmediate={props.allowImmediate ?? true}
        disabled={props.disabled}
      />
    );
  }
  render(<Harness />, { wrapper: AllProviders });
  return onChange;
}

const lastChange = (onChange: ReturnType<typeof vi.fn>) =>
  onChange.mock.lastCall?.[0] as TriggerDraft;

async function choose(combobox: string, option: string | RegExp) {
  fireEvent.click(screen.getByRole('combobox', { name: combobox }));
  fireEvent.click(await screen.findByRole('option', { name: option }));
}

beforeAll(() => initTestI18n(announcementZhTW));

beforeEach(() => {
  fetchEvents.mockReset().mockResolvedValue({
    items: [{ event: 'user.activated' }, { event: 'custom.unknown' }],
  });
  fetchPreview.mockReset().mockResolvedValue({
    timeZone: 'Asia/Taipei',
    occurrences: ['2026-10-12T01:00:00.000Z', '2026-10-19T01:00:00.000Z'],
  });
});

describe('TriggerField（發送時間，docs/architecture/backend/19-announcement.md §9.2 D7）', () => {
  it('新公告可以選立即、指定時間、週期、事件', () => {
    renderField(EMPTY_TRIGGER_DRAFT);
    expect(
      screen.getAllByRole('radio').map((radio) => radio.closest('label')?.textContent),
    ).toEqual(['立即發送', '指定時間', '週期', '事件發生時']);
  });

  it('已送出的公告不能改成立即', () => {
    renderField({ ...EMPTY_TRIGGER_DRAFT, kind: 'once' }, { allowImmediate: false });
    expect(screen.queryByRole('radio', { name: '立即發送' })).not.toBeInTheDocument();
    expect(screen.getByRole('radio', { name: '指定時間' })).toBeInTheDocument();
  });

  it('停用時所有選項都不能操作', () => {
    renderField(EMPTY_TRIGGER_DRAFT, { disabled: true });
    for (const radio of screen.getAllByRole('radio')) {
      expect(radio).toHaveAttribute('aria-disabled', 'true');
    }
  });

  it('指定時間：顯示日期、時間與時區，改時間會回報', async () => {
    const onChange = renderField(EMPTY_TRIGGER_DRAFT);
    await userEvent.click(screen.getByRole('radio', { name: '指定時間' }));
    expect(lastChange(onChange).kind).toBe('once');
    expect(screen.getByRole('button', { name: '發送日期' })).toBeInTheDocument();
    expect(screen.getByText(/^時區：/)).toBeInTheDocument();

    fireEvent.change(screen.getByTestId('announcement-trigger-time'), {
      target: { value: '18:30' },
    });
    expect(lastChange(onChange)).toMatchObject({ kind: 'once', time: '18:30' });
  });

  it('切到週期且沒有開始日期 → 開始日期預設為今天', async () => {
    const onChange = renderField(EMPTY_TRIGGER_DRAFT);
    await userEvent.click(screen.getByRole('radio', { name: '週期' }));
    expect(lastChange(onChange).kind).toBe('recurring');
    expect(lastChange(onChange).startsOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('切到週期時保留已填的開始日期', async () => {
    const onChange = renderField({ ...RECURRING, kind: 'once' });
    await userEvent.click(screen.getByRole('radio', { name: '週期' }));
    expect(lastChange(onChange).startsOn).toBe('2026-10-10');
  });

  it('週期填好 → 依租戶時區預覽接下來的發送時間', async () => {
    renderField(RECURRING);
    const preview = screen.getByTestId('announcement-recurrence-preview');
    expect(await screen.findByText(/依租戶時區 Asia\/Taipei 計算/)).toBeInTheDocument();
    expect(preview.querySelectorAll('li')).toHaveLength(2);
    expect(fetchPreview).toHaveBeenCalledWith(
      expect.objectContaining({
        params: {
          trigger: expect.objectContaining({
            frequency: 'weekly',
            weekdays: [1],
            startsOn: '2026-10-10',
          }),
        },
      }),
    );
  });

  it('週期已經沒有下一次 → 顯示提示', async () => {
    fetchPreview.mockResolvedValue({ timeZone: 'UTC', occurrences: [] });
    renderField(RECURRING);
    expect(await screen.findByText('已經沒有下一次（超過結束日期或次數）')).toBeInTheDocument();
  });

  it('每週但沒有勾任何一天 → 不查預覽，提示還沒填完', async () => {
    renderField({ ...RECURRING, weekdays: [] });
    expect(screen.getByText('填好開始日期與時間後，會顯示接下來的發送時間')).toBeInTheDocument();
    expect(fetchPreview).not.toHaveBeenCalled();
  });

  it('每週：勾選與取消星期幾', async () => {
    const onChange = renderField(RECURRING);
    await userEvent.click(screen.getByRole('checkbox', { name: '週三' }));
    expect(lastChange(onChange).weekdays).toEqual([1, 3]);
    await userEvent.click(screen.getByRole('checkbox', { name: '週一' }));
    expect(lastChange(onChange).weekdays).toEqual([3]);
  });

  it('改頻率為每月 → 選每月的哪一天（含最後一天）', async () => {
    const onChange = renderField(RECURRING);
    await choose('頻率', '個月');
    expect(lastChange(onChange).frequency).toBe('monthly');
    expect(screen.queryByRole('checkbox', { name: '週一' })).not.toBeInTheDocument();

    await choose('每月的哪一天', '最後一天');
    expect(lastChange(onChange).monthDay).toBe('last');
    await choose('每月的哪一天', '15 日');
    expect(lastChange(onChange).monthDay).toBe(15);
  });

  it('週期的時間、間隔與次數上限會回報', async () => {
    const onChange = renderField(RECURRING);
    fireEvent.change(screen.getByTestId('announcement-trigger-time'), {
      target: { value: '07:15' },
    });
    expect(lastChange(onChange).time).toBe('07:15');

    const interval = screen.getByRole('textbox', { name: '間隔' });
    await userEvent.clear(interval);
    await userEvent.type(interval, '3');
    await userEvent.tab();
    await waitFor(() => expect(lastChange(onChange).interval).toBe(3));

    const max = screen.getByRole('textbox', { name: '最多發送次數' });
    await userEvent.type(max, '5');
    await userEvent.tab();
    await waitFor(() => expect(lastChange(onChange).maxOccurrences).toBe(5));
  });

  it('事件：列出觸發點（未知的事件顯示原名），選了之後顯示說明', async () => {
    const onChange = renderField({ ...EMPTY_TRIGGER_DRAFT, kind: 'event' });
    fireEvent.click(screen.getByRole('combobox', { name: '觸發的事件' }));
    expect(await screen.findByRole('option', { name: 'custom.unknown' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('option', { name: '帳號啟用' }));

    expect(lastChange(onChange).event).toBe('user.activated');
    expect(await screen.findByText(/完成啟用、或建立時就能登入/)).toBeInTheDocument();
    expect(screen.getByText(/同一則公告對同一個人只發一次/)).toBeInTheDocument();
  });

  it('事件：延遲的單位與數值會回報', async () => {
    const onChange = renderField({
      ...EMPTY_TRIGGER_DRAFT,
      kind: 'event',
      event: 'user.activated',
    });
    await choose('單位', '小時');
    expect(lastChange(onChange).delayUnit).toBe('hours');

    const delay = screen.getByRole('textbox', { name: '延遲' });
    await userEvent.clear(delay);
    await userEvent.type(delay, '2');
    await userEvent.tab();
    await waitFor(() => expect(lastChange(onChange).delayValue).toBe(2));
  });
});
