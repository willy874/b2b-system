import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { JsonEditor } from './JsonEditor';
import { createJsonSchemaValidator } from './validation';
import type { JsonValidator } from './validation';

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
const broken: JsonValidator = () => Promise.reject(new Error('schema 壞了'));

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

  describe('搜尋', () => {
    const value = { hero: { name: 'Alice' }, npc: { name: 'Bob', alias: 'alice' } };

    it('⌘/Ctrl + F 開啟搜尋列；找得到收合中的節點並展開、標記目前那一筆', async () => {
      render(<JsonEditor defaultValue={value} defaultExpandDepth={1} />);
      fireEvent.keyDown(screen.getByRole('button', { name: '全部展開' }), {
        key: 'f',
        metaKey: true,
      });
      const input = screen.getByRole('searchbox', { name: '搜尋' });
      expect(input).toHaveFocus();

      await userEvent.type(input, 'alice');
      expect(screen.getByTestId('json-editor-search-status')).toHaveTextContent('1 / 2');
      // 原本收合的 hero 被展開，第一筆（hero.name 的值）是目前那一筆
      expect(lineOf('$["hero"]["name"]')).toHaveAttribute('data-active');
      expect(lineOf('$["hero"]["name"]').querySelector('mark')).toHaveTextContent('Alice');

      await userEvent.keyboard('{Enter}');
      expect(screen.getByTestId('json-editor-search-status')).toHaveTextContent('2 / 2');
      expect(lineOf('$["npc"]["alias"]')).toHaveAttribute('data-active');

      await userEvent.keyboard('{Shift>}{Enter}{/Shift}');
      expect(screen.getByTestId('json-editor-search-status')).toHaveTextContent('1 / 2');
    });

    it('沒有結果時提示；Esc 關閉並清掉標記', async () => {
      render(<JsonEditor defaultValue={value} />);
      await userEvent.click(screen.getByRole('button', { name: '搜尋' }));
      await userEvent.type(screen.getByRole('searchbox'), 'zzz');
      expect(screen.getByTestId('json-editor-search-status')).toHaveTextContent('沒有符合的結果');
      expect(screen.getByRole('button', { name: '下一個' })).toBeDisabled();

      await userEvent.keyboard('{Escape}');
      expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
      expect(document.querySelector('mark')).toBeNull();
    });
  });

  describe('驗證', () => {
    const schema = {
      type: 'object',
      properties: {
        stats: { type: 'object', properties: { hp: { type: 'integer', minimum: 0 } } },
      },
    };
    const validator = createJsonSchemaValidator(schema);

    it('錯誤的行標紅、收合的上層有標記；清單點一下展開並跳到那一行', async () => {
      const onValidationChange = vi.fn();
      render(
        <JsonEditor
          defaultValue={{ stats: { hp: -5 } }}
          defaultExpandDepth={1}
          validator={validator}
          onValidationChange={onValidationChange}
        />,
      );
      const item = await screen.findByTestId('json-editor-validation-item');
      expect(item).toHaveTextContent('stats.hp');
      expect(screen.getByRole('region', { name: '1 個驗證錯誤' })).toBeInTheDocument();
      expect(
        lineOf('$["stats"]').querySelector('[data-testid="json-viewer-marker"]'),
      ).toHaveAttribute('data-nested');
      expect(onValidationChange).toHaveBeenLastCalledWith([
        expect.objectContaining({ keyword: 'minimum' }),
      ]);

      await userEvent.click(item);
      expect(lineOf('$["stats"]["hp"]')).toHaveAttribute('data-invalid');
      expect(lineOf('$["stats"]["hp"]')).toHaveAttribute('data-active');
    });

    it('修正後錯誤消失', async () => {
      render(<JsonEditor defaultValue={{ stats: { hp: -5 } }} validator={validator} />);
      await screen.findByTestId('json-editor-validation');
      await userEvent.click(screen.getByRole('button', { name: '編輯值：-5' }));
      await userEvent.clear(screen.getByRole('textbox'));
      await userEvent.type(screen.getByRole('textbox'), '5{Enter}');
      await waitFor(() =>
        expect(screen.queryByTestId('json-editor-validation')).not.toBeInTheDocument(),
      );
    });

    it('validator 失敗（例如 schema 不合法）時回報成根節點的錯誤', async () => {
      render(<JsonEditor defaultValue={{}} validator={broken} />);
      expect(await screen.findByTestId('json-editor-validation-item')).toHaveTextContent(
        '（根）schema 壞了',
      );
    });
  });
});
