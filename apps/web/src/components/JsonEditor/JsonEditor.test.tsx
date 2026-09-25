import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { JsonEditor } from './JsonEditor';

const lineOf = (path: string) =>
  document.querySelector(`[data-testid="json-viewer-item"][data-value='${path}']`) as HTMLElement;

function Controlled() {
  const [value, setValue] = useState<unknown>({ n: 1 });
  return (
    <>
      <JsonEditor value={value} onChange={setValue} />
      <output data-testid="value">{JSON.stringify(value)}</output>
    </>
  );
}
const valueText = () => screen.getByTestId('value').textContent;

describe('JsonEditor', () => {
  it('點值進入編輯，Enter 送出並自動判斷型別', async () => {
    const onChange = vi.fn();
    render(<JsonEditor defaultValue={{ count: 1 }} onChange={onChange} />);

    await userEvent.click(screen.getByRole('button', { name: '編輯值：1' }));
    const input = screen.getByRole('textbox', { name: '編輯值' });
    await userEvent.clear(input);
    await userEvent.type(input, '42{Enter}');

    expect(onChange).toHaveBeenLastCalledWith({ count: 42 });
    expect(screen.getByRole('button', { name: '編輯值：42' })).toBeInTheDocument();
  });

  it('Esc 放棄編輯', async () => {
    const onChange = vi.fn();
    render(<JsonEditor defaultValue={{ name: 'a' }} onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: '編輯值："a"' }));
    await userEvent.type(screen.getByRole('textbox'), 'bc{Escape}');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('改鍵名：重複時標示錯誤、不送出', async () => {
    const onChange = vi.fn();
    render(<JsonEditor defaultValue={{ a: 1, b: 2 }} onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: '編輯鍵名：b' }));
    const input = screen.getByRole('textbox', { name: '編輯鍵名' });
    await userEvent.clear(input);
    await userEvent.type(input, 'a{Enter}');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(onChange).not.toHaveBeenCalled();

    await userEvent.type(input, 'x{Enter}');
    expect(onChange).toHaveBeenLastCalledWith({ a: 1, ax: 2 });
  });

  it('操作選單：刪除、新增子項後直接編輯新鍵名', async () => {
    const onChange = vi.fn();
    render(<JsonEditor defaultValue={{ a: 1, list: [] }} onChange={onChange} />);

    await userEvent.click(within(lineOf('$["a"]')).getByRole('button', { name: '操作' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: '刪除' }));
    expect(onChange).toHaveBeenLastCalledWith({ list: [] });

    await userEvent.click(within(lineOf('$')).getByRole('button', { name: '操作' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: '新增子項' }));
    expect(onChange).toHaveBeenLastCalledWith({ list: [], newKey: '' });
    const keyInput = screen.getByRole('textbox', { name: '編輯鍵名' });
    expect(keyInput).toHaveFocus();

    // 鍵名送出後接著編輯值
    await userEvent.clear(keyInput);
    await userEvent.type(keyInput, 'hp{Enter}');
    const valueInput = screen.getByRole('textbox', { name: '編輯值' });
    expect(valueInput).toHaveFocus();
    await userEvent.type(valueInput, '10{Enter}');
    expect(onChange).toHaveBeenLastCalledWith({ list: [], hp: 10 });
  });

  it('復原／重做（按鈕與 ⌘/Ctrl + Z）', async () => {
    render(<Controlled />);

    await userEvent.click(screen.getByRole('button', { name: '編輯值：1' }));
    await userEvent.type(screen.getByRole('textbox'), '{Backspace}2{Enter}');
    expect(valueText()).toBe('{"n":2}');

    await userEvent.click(screen.getByRole('button', { name: '復原' }));
    expect(valueText()).toBe('{"n":1}');
    await userEvent.click(screen.getByRole('button', { name: '重做' }));
    expect(valueText()).toBe('{"n":2}');

    fireEvent.keyDown(screen.getByRole('button', { name: '編輯值：2' }), {
      key: 'z',
      ctrlKey: true,
    });
    expect(valueText()).toBe('{"n":1}');
  });

  it('文字模式：合法 JSON 即時套用，不合法時顯示錯誤且不能切回樹狀', async () => {
    const onChange = vi.fn();
    render(
      <JsonEditor
        defaultValue={{ a: 1 }}
        onChange={onChange}
        defaultMode="text"
        aria-label="設定"
      />,
    );
    const textarea = screen.getByRole('textbox', { name: '設定' });
    expect(textarea).toHaveValue('{\n  "a": 1\n}');

    fireEvent.change(textarea, { target: { value: '{"a": 2}' } });
    expect(onChange).toHaveBeenLastCalledWith({ a: 2 });

    fireEvent.change(textarea, { target: { value: '{"a": ' } });
    expect(screen.getByRole('alert')).toHaveTextContent('不是合法的 JSON');
    expect(textarea).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('button', { name: '樹狀' })).toBeDisabled();
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('readOnly：鍵名與值不能編輯、沒有操作選單與復原', () => {
    render(<JsonEditor defaultValue={{ a: 1 }} readOnly />);
    expect(screen.queryByRole('button', { name: /編輯/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '操作' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '復原' })).not.toBeInTheDocument();
  });

  it('全部收合只留根節點展開', async () => {
    render(<JsonEditor defaultValue={{ a: { b: 1 }, c: [1] }} />);
    await userEvent.click(screen.getByRole('button', { name: '全部收合' }));
    expect(document.querySelectorAll('[data-testid="json-viewer-item"]')).toHaveLength(4);
  });
});
