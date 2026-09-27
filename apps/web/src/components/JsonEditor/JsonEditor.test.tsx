import { foldedRanges } from '@codemirror/language';
import { forEachDiagnostic } from '@codemirror/lint';
import { EditorView } from '@codemirror/view';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { JsonEditor } from './JsonEditor';
import { createJsonSchemaValidator } from './validation';
import type { JsonValidator } from './validation';

beforeAll(() => {
  // jsdom 沒有 Range 的版面 API，CodeMirror 量測文字時會呼叫；回傳空的量測結果即可
  Range.prototype.getClientRects ??= () =>
    Object.assign([], { item: () => null }) as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect ??= () => new DOMRect();
});

/** 測試裡直接對 CodeMirror 送 transaction：jsdom 沒辦法模擬 contenteditable 的輸入。 */
const editorView = () =>
  EditorView.findFromDOM(
    screen.getByTestId('json-editor-content').querySelector('.cm-editor') as HTMLElement,
  ) as EditorView;

const documentText = () => editorView().state.doc.toString();

const replaceDocument = (text: string) =>
  act(() => {
    const view = editorView();
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
  });

const selectedText = () => {
  const { state } = editorView();
  return state.sliceDoc(state.selection.main.from, state.selection.main.to);
};

const foldCount = () => foldedRanges(editorView().state).size;

/** 畫了波浪底線的文字與訊息。 */
const diagnostics = () => {
  const { state } = editorView();
  const found: Array<[string, string]> = [];
  forEachDiagnostic(state, (diagnostic, from, to) => {
    found.push([state.sliceDoc(from, to), diagnostic.message]);
  });
  return found;
};

function Controlled({ initial }: { initial: unknown }) {
  const [value, setValue] = useState<unknown>(initial);
  return (
    <>
      <JsonEditor value={value} onChange={setValue} />
      <button type="button" onClick={() => setValue({ replaced: true })}>
        外部更新
      </button>
      <output data-testid="value">{JSON.stringify(value)}</output>
    </>
  );
}

const broken: JsonValidator = () => Promise.reject(new Error('schema 壞了'));

describe('JsonEditor', () => {
  it('以縮排 2 格的 JSON 顯示，內容合法時即時回報解析後的值', () => {
    const onChange = vi.fn();
    render(<JsonEditor defaultValue={{ a: 1 }} onChange={onChange} aria-label="設定" />);
    expect(documentText()).toBe('{\n  "a": 1\n}');
    expect(screen.getByRole('textbox', { name: '設定' })).toBeInTheDocument();

    replaceDocument('{"a": 2}');
    expect(onChange).toHaveBeenLastCalledWith({ a: 2 });
  });

  it('內容不合法時顯示錯誤、標示 aria-invalid，不回報也不能格式化', () => {
    const onChange = vi.fn();
    render(<JsonEditor defaultValue={{ a: 1 }} onChange={onChange} aria-label="設定" />);

    replaceDocument('{"a": ');
    expect(screen.getByRole('alert')).toHaveTextContent('不是合法的 JSON');
    expect(screen.getByRole('textbox', { name: '設定' })).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('button', { name: '格式化' })).toBeDisabled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('格式化／壓縮只改排版，不回報 onChange', async () => {
    const onChange = vi.fn();
    render(<JsonEditor defaultValue={{ a: [1, 2] }} onChange={onChange} />);

    await userEvent.click(screen.getByRole('button', { name: '壓縮' }));
    expect(documentText()).toBe('{"a":[1,2]}');
    await userEvent.click(screen.getByRole('button', { name: '格式化' }));
    expect(documentText()).toBe('{\n  "a": [\n    1,\n    2\n  ]\n}');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('復原／重做', async () => {
    render(<Controlled initial={{ n: 1 }} />);
    const undo = screen.getByRole('button', { name: '復原' });
    expect(undo).toHaveAttribute('aria-disabled', 'true');

    replaceDocument('{"n": 2}');
    expect(screen.getByTestId('value')).toHaveTextContent('{"n":2}');

    await userEvent.click(undo);
    expect(screen.getByTestId('value')).toHaveTextContent('{"n":1}');
    await userEvent.click(screen.getByRole('button', { name: '重做' }));
    expect(screen.getByTestId('value')).toHaveTextContent('{"n":2}');
  });

  it('受控：自己回報的值不重建內容；外部換值時整份重新產生並清空復原紀錄', async () => {
    render(<Controlled initial={{ n: 1 }} />);
    replaceDocument('{"n":2}');
    // 沒有被重新格式化成縮排版，代表沒有重建
    expect(documentText()).toBe('{"n":2}');

    await userEvent.click(screen.getByRole('button', { name: '外部更新' }));
    expect(documentText()).toBe('{\n  "replaced": true\n}');
    expect(screen.getByRole('button', { name: '復原' })).toHaveAttribute('aria-disabled', 'true');
  });

  it('readOnly：內容不能改，沒有格式化與復原', () => {
    render(<JsonEditor defaultValue={{ a: 1 }} readOnly />);
    expect(editorView().state.readOnly).toBe(true);
    expect(screen.queryByRole('button', { name: '格式化' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '復原' })).not.toBeInTheDocument();
  });

  it('defaultExpandDepth 以下一開始是摺疊的；全部展開／全部收合（根節點保持展開）', async () => {
    render(<JsonEditor defaultValue={{ a: { b: { c: 1 } }, list: [1] }} defaultExpandDepth={2} />);
    expect(foldCount()).toBe(1);

    await userEvent.click(screen.getByRole('button', { name: '全部展開' }));
    expect(foldCount()).toBe(0);
    await userEvent.click(screen.getByRole('button', { name: '全部收合' }));
    expect(foldCount()).toBe(2);
  });

  describe('搜尋', () => {
    const value = { hero: { name: 'Alice' }, npc: { name: 'Bob', alias: 'alice' } };

    it('搜尋列出現在編輯區；不分大小寫，選取目前那一筆並展開摺疊', async () => {
      render(<JsonEditor defaultValue={value} defaultExpandDepth={1} />);
      await userEvent.click(screen.getByRole('button', { name: '搜尋' }));
      const input = screen.getByRole('searchbox', { name: '搜尋' });
      expect(screen.getByTestId('json-editor-content')).toContainElement(input);
      expect(input).toHaveFocus();

      await userEvent.type(input, 'alice');
      expect(screen.getByTestId('json-editor-search-status')).toHaveTextContent('1 / 2');
      expect(selectedText()).toBe('Alice');
      // 原本摺疊的 hero 被打開
      expect(foldCount()).toBe(1);

      await userEvent.keyboard('{Enter}');
      expect(screen.getByTestId('json-editor-search-status')).toHaveTextContent('2 / 2');
      expect(foldCount()).toBe(0);

      await userEvent.keyboard('{Shift>}{Enter}{/Shift}');
      expect(screen.getByTestId('json-editor-search-status')).toHaveTextContent('1 / 2');
    });

    it('沒有結果時提示；Esc 關閉', async () => {
      render(<JsonEditor defaultValue={value} />);
      await userEvent.click(screen.getByRole('button', { name: '搜尋' }));
      await userEvent.type(screen.getByRole('searchbox'), 'zzz');
      expect(screen.getByTestId('json-editor-search-status')).toHaveTextContent('沒有符合的結果');
      expect(screen.getByRole('button', { name: '下一個' })).toBeDisabled();

      await userEvent.keyboard('{Escape}');
      expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
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

    it('列出錯誤並畫上底線；點一下展開摺疊並選取出錯的位置', async () => {
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
      expect(item).toHaveAttribute('data-value', '$["stats"]["hp"]');
      expect(screen.getByRole('region', { name: '1 個驗證錯誤' })).toBeInTheDocument();
      await waitFor(() =>
        expect(onValidationChange).toHaveBeenLastCalledWith([
          expect.objectContaining({ keyword: 'minimum' }),
        ]),
      );

      await userEvent.click(item);
      expect(foldCount()).toBe(0);
      expect(selectedText()).toBe('"hp": -5');
      await waitFor(() =>
        expect(diagnostics()).toEqual([['"hp": -5', expect.stringContaining('>= 0')]]),
      );
    });

    it('修正後錯誤消失', async () => {
      render(<JsonEditor defaultValue={{ stats: { hp: -5 } }} validator={validator} />);
      await screen.findByTestId('json-editor-validation');
      replaceDocument('{"stats": {"hp": 5}}');
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
