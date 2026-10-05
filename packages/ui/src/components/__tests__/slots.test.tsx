import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Accordion } from '../Accordion';
import { Checkbox } from '../Checkbox';
import { Calendar } from '../DatePicker/Calendar';
import { Empty } from '../Empty';
import { ScrollArea } from '../ScrollArea';
import { createSlots } from '../slots';
import type { TableColumnDef } from '../Table';
import { Table } from '../Table';

/** 多層元件的逐層覆寫（docs/architecture/frontend/07-ui-system.md §3.1 規則 6）。 */
describe('createSlots', () => {
  it('沒有覆寫時只回傳預設值', () => {
    const slot = createSlots<'title'>({});
    expect(slot('title', 'ge-x__title', { testId: 'x-title' })).toEqual({
      className: 'ge-x__title',
      style: undefined,
      'data-testid': 'x-title',
    });
  });

  it('className 疊加在預設 class 之後', () => {
    const slot = createSlots<'title'>({ classNames: { title: 'custom' } });
    expect(slot('title', ['ge-x__title', undefined]).className).toBe('ge-x__title custom');
  });

  it('style 逐屬性合併，呼叫端優先', () => {
    const slot = createSlots<'body'>({ styles: { body: { maxHeight: 10, color: 'inherit' } } });
    expect(slot('body', undefined, { style: { maxHeight: 320, padding: 4 } }).style).toEqual({
      maxHeight: 10,
      padding: 4,
      color: 'inherit',
    });
  });

  it('testId 取代預設值；沒有 class 時不輸出空字串', () => {
    const slot = createSlots<'body'>({ testIds: { body: 'my-body' } });
    expect(slot('body', undefined, { testId: 'x-body' })).toEqual({
      className: undefined,
      style: undefined,
      'data-testid': 'my-body',
    });
  });
});

describe('元件的逐層覆寫', () => {
  it('Empty：classNames / styles / testIds 套到對應的層', () => {
    render(
      <Empty
        title="空"
        description="說明"
        classNames={{ title: 'my-title' }}
        styles={{ description: { opacity: 0.5 } }}
        testIds={{ title: 'empty-title' }}
      />,
    );
    const title = screen.getByTestId('empty-title');
    expect(title).toHaveClass('my-title');
    expect(screen.getByText('說明')).toHaveStyle({ opacity: '0.5' });
  });

  it('Accordion：列表項目的 testid 可覆寫，data-value 保留', () => {
    render(
      <Accordion
        items={[{ value: 'a', title: 'A', content: '內容' }]}
        testIds={{ trigger: 'faq-trigger' }}
      />,
    );
    const trigger = screen.getByTestId('faq-trigger');
    expect(trigger).toHaveAttribute('data-value', 'a');
    expect(screen.queryByTestId('accordion-trigger')).not.toBeInTheDocument();
  });

  it('ScrollArea：viewport 的 maxHeight 可被 styles 覆寫', () => {
    render(
      <ScrollArea
        maxHeight={320}
        styles={{ viewport: { maxHeight: 100 } }}
        testIds={{ viewport: 'vp' }}
      >
        x
      </ScrollArea>,
    );
    expect(screen.getByTestId('vp')).toHaveStyle({ maxHeight: '100px' });
  });

  it('Checkbox：頂層 data-testid 仍落在 control，優先於 testIds.control', () => {
    render(
      <Checkbox
        aria-label="同意"
        data-testid="agree"
        testIds={{ control: 'ignored' }}
        classNames={{ indicator: 'my-indicator' }}
        defaultChecked
      />,
    );
    expect(screen.getByRole('checkbox', { name: '同意' })).toHaveAttribute('data-testid', 'agree');
  });

  it('Table：骨架列只套 class，不帶 row 的 testid', () => {
    const columns: Array<TableColumnDef<{ id: string }>> = [
      { id: 'id', header: 'ID', cell: ({ row }) => row.original.id },
    ];
    const { container } = render(
      <Table
        data={[]}
        columns={columns}
        loading
        classNames={{ row: 'my-row' }}
        testIds={{ row: 'role-row' }}
      />,
    );
    expect(container.querySelectorAll('tr.my-row')).toHaveLength(5);
    expect(screen.queryAllByTestId('role-row')).toHaveLength(0);
  });

  it('Calendar：覆寫 day 的 testid 後鍵盤移動仍會聚焦', async () => {
    render(
      <Calendar
        selected={['2026-09-15']}
        onSelect={vi.fn()}
        testIds={{ day: 'my-day' }}
        classNames={{ day: 'my-day-class' }}
      />,
    );
    const start = document.querySelector<HTMLElement>(
      '[data-testid="my-day"][data-value="2026-09-15"]',
    );
    expect(start).toHaveClass('my-day-class');
    start?.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(document.activeElement).toHaveAttribute('data-value', '2026-09-16');
  });
});
