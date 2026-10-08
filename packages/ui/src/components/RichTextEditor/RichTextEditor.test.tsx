import type { RichTextDocument, RichTextNode } from '@b2b-system/rich-text';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Editor, TiptapEditorHTMLElement } from '@tiptap/core';
import { Activity, useState } from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { Field } from '../Field';
import { RichTextEditor } from './RichTextEditor';

beforeAll(() => {
  // jsdom 沒有 Range 的版面 API，ProseMirror 捲動到游標時會呼叫；回傳空的量測結果即可
  Range.prototype.getClientRects ??= () =>
    Object.assign([], { item: () => null }) as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect ??= () => new DOMRect();
});

const text = (value: string, marks?: RichTextNode['marks']): RichTextNode => ({
  type: 'text',
  text: value,
  ...(marks ? { marks } : {}),
});
const paragraph = (...content: RichTextNode[]): RichTextNode => ({ type: 'paragraph', content });
const doc = (...content: RichTextNode[]): RichTextDocument => ({ type: 'doc', content });

/** 編輯區：ProseMirror 的 contenteditable。 */
const textbox = () => screen.getByRole('textbox');

/**
 * 測試裡直接對編輯器下指令：jsdom 沒辦法模擬 contenteditable 的輸入。
 * Tiptap 把 Editor 掛在編輯區的 DOM 上（`TiptapEditorHTMLElement.editor`）。
 */
const editorOf = () => {
  const editor = (textbox() as TiptapEditorHTMLElement).editor;
  if (!editor) throw new Error('找不到編輯器');
  return editor;
};

const command = (run: (editor: Editor) => void) =>
  act(() => {
    run(editorOf());
  });

const toolbarButton = (key: string) =>
  within(screen.getByTestId('rich-text-editor-toolbar'))
    .getAllByTestId('toolbar-item')
    .find((button) => button.getAttribute('data-value') === key) as HTMLElement;

function Controlled({ initial }: { initial: RichTextDocument }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <RichTextEditor value={value} onChange={setValue} aria-label="內容" />
      <button type="button" onClick={() => setValue(doc(paragraph(text('外部的內容'))))}>
        外部更新
      </button>
      <output data-testid="value">{JSON.stringify(value)}</output>
    </>
  );
}

describe('RichTextEditor', () => {
  it('顯示初始內容，編輯區是有名稱的多行 textbox', () => {
    render(
      <RichTextEditor
        defaultValue={doc(paragraph(text('粗體', [{ type: 'bold' }]), text('與一般')))}
        aria-label="內容"
      />,
    );
    expect(textbox()).toHaveAccessibleName('內容');
    expect(textbox()).toHaveAttribute('aria-multiline', 'true');
    expect(textbox()).toHaveAttribute('contenteditable', 'true');
    expect(within(textbox()).getByText('粗體').tagName).toBe('STRONG');
  });

  it('編輯時以 onChange 回報 ProseMirror 的文件 JSON', () => {
    const onChange = vi.fn();
    render(<RichTextEditor onChange={onChange} aria-label="內容" />);
    command((editor) => editor.commands.insertContent('哈囉'));
    expect(onChange).toHaveBeenLastCalledWith(doc(paragraph(text('哈囉'))));
  });

  it('工具列的格式按鈕套用到選取範圍，按下後帶 aria-pressed', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <RichTextEditor
        defaultValue={doc(paragraph(text('重點')))}
        onChange={onChange}
        aria-label="內容"
      />,
    );
    expect(toolbarButton('bold')).toHaveAttribute('aria-pressed', 'false');
    command((editor) => editor.commands.selectAll());
    await user.click(toolbarButton('bold'));
    expect(onChange).toHaveBeenLastCalledWith(doc(paragraph(text('重點', [{ type: 'bold' }]))));
    expect(toolbarButton('bold')).toHaveAttribute('aria-pressed', 'true');
  });

  it('標題切換目前的區塊；最後一個區塊不是段落時，尾端補一個空段落方便繼續輸入', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <RichTextEditor
        defaultValue={doc(paragraph(text('一行')))}
        onChange={onChange}
        aria-label="內容"
      />,
    );
    command((editor) => editor.commands.setTextSelection(1));
    await user.click(toolbarButton('heading-2'));
    expect(onChange).toHaveBeenLastCalledWith(
      doc({ type: 'heading', attrs: { level: 2 }, content: [text('一行')] }, { type: 'paragraph' }),
    );
    // 清單項目只能放段落：游標在標題裡時清單按鈕停用
    expect(toolbarButton('bullet-list')).toHaveAttribute('aria-disabled', 'true');
  });

  it('清單包住目前的段落', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <RichTextEditor
        defaultValue={doc(paragraph(text('一行')))}
        onChange={onChange}
        aria-label="內容"
      />,
    );
    command((editor) => editor.commands.setTextSelection(1));
    await user.click(toolbarButton('bullet-list'));
    expect(onChange).toHaveBeenLastCalledWith(
      doc(
        {
          type: 'bulletList',
          content: [{ type: 'listItem', content: [paragraph(text('一行'))] }],
        },
        { type: 'paragraph' },
      ),
    );
    expect(toolbarButton('bullet-list')).toHaveAttribute('aria-pressed', 'true');
  });

  it('復原／重做：沒有紀錄時停用，編輯後可以復原', async () => {
    const user = userEvent.setup();
    render(<RichTextEditor defaultValue={doc(paragraph(text('原文')))} aria-label="內容" />);
    expect(toolbarButton('undo')).toHaveAttribute('aria-disabled', 'true');
    command((editor) => editor.commands.insertContentAt(1, '新'));
    expect(textbox()).toHaveTextContent('新原文');
    await user.click(toolbarButton('undo'));
    expect(textbox()).toHaveTextContent(/^原文$/);
    expect(toolbarButton('redo')).not.toHaveAttribute('aria-disabled');
  });

  it('formats 只開放的格式才有按鈕，貼上其他格式會被拿掉', () => {
    const onChange = vi.fn();
    render(<RichTextEditor formats={['bold']} onChange={onChange} aria-label="內容" />);
    const keys = within(screen.getByTestId('rich-text-editor-toolbar'))
      .getAllByTestId('toolbar-item')
      .map((button) => button.getAttribute('data-value'));
    expect(keys).toEqual(['bold', 'undo', 'redo']);

    command((editor) =>
      editor.commands.insertContent(
        '<h2>標題</h2><p><strong>粗</strong><em>斜</em><a href="https://example.com">連結</a></p>',
      ),
    );
    expect(onChange).toHaveBeenLastCalledWith(
      doc(paragraph(text('標題')), paragraph(text('粗', [{ type: 'bold' }]), text('斜連結'))),
    );
  });

  it('既有內容含沒開放的格式時保留文字（不會整份清空）', () => {
    render(
      <RichTextEditor
        formats={['bold']}
        defaultValue={doc(
          { type: 'heading', attrs: { level: 2 }, content: [text('標題', [{ type: 'italic' }])] },
          {
            type: 'bulletList',
            content: [{ type: 'listItem', content: [paragraph(text('項目'))] }],
          },
        )}
        aria-label="內容"
      />,
    );
    expect(editorOf().getJSON()).toEqual(doc(paragraph(text('標題')), paragraph(text('項目'))));
  });

  it('貼上的 javascript: 連結不會變成連結', () => {
    const onChange = vi.fn();
    render(<RichTextEditor onChange={onChange} aria-label="內容" />);
    command((editor) =>
      editor.commands.insertContent('<p><a href="javascript:alert(1)">點我</a></p>'),
    );
    expect(onChange).toHaveBeenLastCalledWith(doc(paragraph(text('點我'))));
  });

  it('受控：外部換值時整份內容重建，復原紀錄清空、不回報 onChange', async () => {
    const user = userEvent.setup();
    render(<Controlled initial={doc(paragraph(text('原本')))} />);
    command((editor) => editor.commands.insertContentAt(1, '改'));
    expect(screen.getByTestId('value')).toHaveTextContent('改原本');
    expect(toolbarButton('undo')).not.toHaveAttribute('aria-disabled');

    await user.click(screen.getByRole('button', { name: '外部更新' }));
    expect(textbox()).toHaveTextContent('外部的內容');
    expect(screen.getByTestId('value')).toHaveTextContent('外部的內容');
    expect(toolbarButton('undo')).toHaveAttribute('aria-disabled', 'true');
  });

  it('受控：自己回報的值傳回來時不重建（復原紀錄保留）', () => {
    render(<Controlled initial={doc(paragraph(text('原本')))} />);
    command((editor) => editor.commands.insertContentAt(1, '改'));
    expect(toolbarButton('undo')).not.toHaveAttribute('aria-disabled');
    command((editor) => editor.commands.undo());
    expect(screen.getByTestId('value')).toHaveTextContent('原本');
    expect(textbox()).toHaveTextContent(/^原本$/);
  });

  it('readOnly：沒有工具列、不能編輯', () => {
    render(
      <RichTextEditor defaultValue={doc(paragraph(text('唯讀')))} readOnly aria-label="內容" />,
    );
    expect(screen.queryByTestId('rich-text-editor-toolbar')).not.toBeInTheDocument();
    expect(textbox()).toHaveAttribute('contenteditable', 'false');
    expect(textbox()).toHaveAttribute('aria-readonly', 'true');
  });

  it('disabled：不能編輯，工具列的按鈕都停用', () => {
    render(<RichTextEditor disabled aria-label="內容" data-testid="editor" />);
    expect(textbox()).toHaveAttribute('contenteditable', 'false');
    expect(textbox()).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByTestId('editor')).toHaveAttribute('data-disabled');
    for (const button of within(screen.getByTestId('rich-text-editor-toolbar')).getAllByTestId(
      'toolbar-item',
    )) {
      expect(button).toHaveAttribute('aria-disabled', 'true');
    }
  });

  it('切換 readOnly 不回報 onChange', () => {
    const onChange = vi.fn();
    const { rerender } = render(<RichTextEditor onChange={onChange} aria-label="內容" />);
    rerender(<RichTextEditor onChange={onChange} readOnly aria-label="內容" />);
    expect(textbox()).toHaveAttribute('contenteditable', 'false');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('maxLength：顯示字數，到上限後不能再輸入', () => {
    render(
      <RichTextEditor
        defaultValue={doc(paragraph(text('一二三')))}
        maxLength={5}
        aria-label="內容"
      />,
    );
    expect(screen.getByTestId('rich-text-editor-footer')).toHaveTextContent('3 / 5');
    // 超過上限的編輯整筆被擋下（貼上則會截斷）
    command((editor) => editor.commands.insertContentAt(4, '四五六'));
    expect(textbox()).toHaveTextContent(/^一二三$/);
    command((editor) => editor.commands.insertContentAt(4, '四五'));
    expect(textbox()).toHaveTextContent('一二三四五');
    expect(screen.getByTestId('rich-text-editor-footer')).toHaveTextContent('5 / 5');
    expect(screen.getByTestId('rich-text-editor-footer')).toHaveAttribute('data-full');
  });

  it('placeholder：空白時顯示在第一個段落，並標在 aria-placeholder', () => {
    render(<RichTextEditor placeholder="寫點什麼…" aria-label="內容" />);
    expect(textbox()).toHaveAttribute('aria-placeholder', '寫點什麼…');
    expect(textbox().querySelector('p')).toHaveAttribute('data-placeholder', '寫點什麼…');
  });

  it('placeholder 改變（切換語系）時不重建編輯器就更新', () => {
    const { rerender } = render(<RichTextEditor placeholder="寫點什麼…" aria-label="內容" />);
    const editor = editorOf();
    rerender(<RichTextEditor placeholder="Write something…" aria-label="內容" />);
    expect(editorOf()).toBe(editor);
    expect(textbox().querySelector('p')).toHaveAttribute('data-placeholder', 'Write something…');
  });

  it('放在 Field 裡：以標籤命名，錯誤以 aria-describedby 連到編輯區', async () => {
    const user = userEvent.setup();
    render(
      <Field label="說明" error="請填寫說明">
        <RichTextEditor />
      </Field>,
    );
    expect(textbox()).toHaveAccessibleName('說明');
    expect(textbox()).toHaveAttribute('aria-invalid', 'true');
    expect(textbox()).toHaveAccessibleDescription('請填寫說明');
    await user.click(screen.getByText('說明'));
    expect(textbox()).toHaveFocus();
  });

  it('onBlur：焦點離開編輯區時通知', () => {
    const onBlur = vi.fn();
    render(<RichTextEditor onBlur={onBlur} aria-label="內容" />);
    act(() => textbox().focus());
    expect(onBlur).not.toHaveBeenCalled();
    act(() => textbox().blur());
    expect(onBlur).toHaveBeenCalledTimes(1);
  });

  describe('連結', () => {
    it('選取文字後在連結列輸入網址：沒寫協定的補上 https://', async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      render(
        <RichTextEditor
          defaultValue={doc(paragraph(text('官網')))}
          onChange={onChange}
          aria-label="內容"
        />,
      );
      command((editor) => editor.commands.selectAll());
      await user.click(toolbarButton('link'));
      const input = screen.getByTestId('rich-text-editor-link-input');
      expect(input).toHaveFocus();
      await user.type(input, 'example.com{Enter}');
      expect(onChange).toHaveBeenLastCalledWith(
        doc(
          paragraph(
            text('官網', [
              {
                type: 'link',
                attrs: expect.objectContaining({ href: 'https://example.com' }) as Record<
                  string,
                  unknown
                >,
              },
            ]),
          ),
        ),
      );
      expect(screen.queryByTestId('rich-text-editor-link')).not.toBeInTheDocument();
    });

    it('不能用的網址顯示錯誤，不套用', async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      render(
        <RichTextEditor
          defaultValue={doc(paragraph(text('點我')))}
          onChange={onChange}
          aria-label="內容"
        />,
      );
      command((editor) => editor.commands.selectAll());
      await user.click(toolbarButton('link'));
      await user.type(screen.getByTestId('rich-text-editor-link-input'), 'javascript:alert(1)');
      await user.click(screen.getByTestId('rich-text-editor-link-apply'));
      expect(screen.getByRole('alert')).toHaveTextContent(
        '請輸入 http、https 或 mailto 開頭的網址',
      );
      expect(screen.getByTestId('rich-text-editor-link-input')).toHaveAttribute(
        'aria-invalid',
        'true',
      );
      expect(onChange).not.toHaveBeenCalled();
    });

    it('游標在連結上：連結列帶出目前的網址，可以移除連結', async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      render(
        <RichTextEditor
          defaultValue={doc(
            paragraph(text('官網', [{ type: 'link', attrs: { href: 'https://example.com' } }])),
          )}
          onChange={onChange}
          aria-label="內容"
        />,
      );
      command((editor) => editor.commands.setTextSelection(2));
      expect(toolbarButton('link')).toHaveAttribute('aria-pressed', 'true');
      await user.click(toolbarButton('link'));
      expect(screen.getByTestId('rich-text-editor-link-input')).toHaveValue('https://example.com');
      await user.click(screen.getByTestId('rich-text-editor-link-remove'));
      expect(onChange).toHaveBeenLastCalledWith(doc(paragraph(text('官網'))));
    });

    it('沒有選取文字時插入網址本身當作連結文字', async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      render(<RichTextEditor onChange={onChange} aria-label="內容" />);
      await user.click(toolbarButton('link'));
      await user.type(
        screen.getByTestId('rich-text-editor-link-input'),
        'https://a.example{Enter}',
      );
      expect(onChange).toHaveBeenLastCalledWith(
        doc(
          paragraph(
            text('https://a.example', [
              {
                type: 'link',
                attrs: expect.objectContaining({ href: 'https://a.example' }) as Record<
                  string,
                  unknown
                >,
              },
            ]),
          ),
        ),
      );
    });

    it('⌘/Ctrl + K 打開連結列，Esc 關閉並把焦點還給編輯區', async () => {
      const user = userEvent.setup();
      render(<RichTextEditor aria-label="內容" />);
      act(() => textbox().focus());
      await user.keyboard('{Control>}k{/Control}');
      const input = await screen.findByTestId('rich-text-editor-link-input');
      await user.type(input, '{Escape}');
      expect(screen.queryByTestId('rich-text-editor-link')).not.toBeInTheDocument();
      await waitFor(() => expect(textbox()).toHaveFocus());
    });
  });

  it('暫時藏起來再顯示（Suspense 的 fallback、Activity：effect 清掉但 state 保留，Tiptap 會銷毀沒掛載的編輯器）：照常運作', async () => {
    const { rerender } = render(
      <Activity mode="visible">
        <RichTextEditor maxLength={10} aria-label="內容" />
      </Activity>,
    );
    command((editor) => editor.commands.insertContent('嗨'));
    rerender(
      <Activity mode="hidden">
        <RichTextEditor maxLength={10} aria-label="內容" />
      </Activity>,
    );
    // 等 Tiptap 的延遲銷毀（1ms）跑完
    await act(() => new Promise((done) => setTimeout(done, 20)));
    rerender(
      <Activity mode="visible">
        <RichTextEditor maxLength={10} aria-label="內容" />
      </Activity>,
    );
    await waitFor(() => expect(editorOf().isDestroyed).toBe(false));
    expect(screen.getByTestId('rich-text-editor-footer')).toHaveTextContent('/ 10');
    command((editor) => editor.commands.insertContent('好'));
    expect(textbox()).toHaveTextContent('好');
  });

  it('透傳 className、data-testid 與 slot 的覆寫', () => {
    render(
      <RichTextEditor
        aria-label="內容"
        className="extra"
        data-testid="editor"
        maxLength={10}
        classNames={{ content: 'content-extra' }}
        testIds={{ toolbar: 'my-toolbar', footer: 'my-footer' }}
      />,
    );
    expect(screen.getByTestId('editor')).toHaveClass('extra');
    expect(screen.getByTestId('my-toolbar')).toBeInTheDocument();
    expect(screen.getByTestId('my-footer')).toBeInTheDocument();
    expect(screen.getByTestId('rich-text-editor-content')).toHaveClass('content-extra');
  });

  it('labels 覆寫按鈕名稱', () => {
    render(<RichTextEditor aria-label="內容" labels={{ bold: 'Bold' }} />);
    expect(screen.getByRole('button', { name: 'Bold' })).toBeInTheDocument();
  });
});
