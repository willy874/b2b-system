import { render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { Field } from '../Field';
import { LazyRichTextEditor, preloadRichTextEditor } from './LazyRichTextEditor';

beforeAll(() => {
  // jsdom 沒有 Range 的版面 API，ProseMirror 捲動到游標時會呼叫；回傳空的量測結果即可
  Range.prototype.getClientRects ??= () =>
    Object.assign([], { item: () => null }) as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect ??= () => new DOMRect();
});

describe('LazyRichTextEditor', () => {
  // `lazy()` 載入過一次之後就不再顯示骨架：骨架只能在這個檔案的第一個測試看到
  it('載入中顯示骨架（status、aria-busy；readOnly 沒有工具列），載入後換成編輯器', async () => {
    render(
      <>
        <LazyRichTextEditor aria-label="可編輯" data-testid="editor" />
        <LazyRichTextEditor aria-label="唯讀" readOnly />
      </>,
    );
    const [editable, readOnly] = screen.getAllByTestId('rich-text-editor-loading');
    expect(editable).toHaveAttribute('aria-busy', 'true');
    expect(editable).toHaveAccessibleName('載入中');
    expect(editable?.children).toHaveLength(2);
    expect(readOnly?.children).toHaveLength(1);

    expect(await screen.findByRole('textbox', { name: '可編輯' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '唯讀' })).toHaveAttribute('aria-readonly', 'true');
    expect(screen.getByTestId('editor')).toBeInTheDocument();
    expect(screen.queryByTestId('rich-text-editor-loading')).not.toBeInTheDocument();
  });

  it('props 原樣交給編輯器：值、ref、Field 的標籤', async () => {
    const ref = createRef<HTMLDivElement>();
    render(
      <Field label="說明">
        <LazyRichTextEditor
          ref={ref}
          defaultValue={{
            type: 'doc',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: '原文' }] }],
          }}
          onChange={vi.fn()}
        />
      </Field>,
    );
    const textbox = await screen.findByRole('textbox', { name: '說明' });
    expect(textbox).toHaveTextContent('原文');
    expect(ref.current).toBeInstanceOf(HTMLDivElement);
  });

  it('preloadRichTextEditor 可以重複呼叫、不丟出錯誤（可以直接當事件處理函式）', async () => {
    expect(() => {
      preloadRichTextEditor();
      preloadRichTextEditor();
    }).not.toThrow();
    render(<LazyRichTextEditor aria-label="預先載入" />);
    expect(await screen.findByRole('textbox', { name: '預先載入' })).toBeInTheDocument();
  });
});
