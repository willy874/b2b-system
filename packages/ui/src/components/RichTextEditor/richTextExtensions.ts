import { isSafeLinkHref, RICH_TEXT_HEADING_LEVELS } from '@b2b-system/rich-text';
import type { RichTextFormat } from '@b2b-system/rich-text';
import { Extension } from '@tiptap/core';
import type { Editor, Extensions } from '@tiptap/core';
import { CharacterCount, Placeholder } from '@tiptap/extensions';
import StarterKit from '@tiptap/starter-kit';

export interface RichTextExtensionOptions {
  formats: ReadonlySet<RichTextFormat>;
  /** 字數上限（純文字的字元數）；`undefined` 不限制。 */
  maxLength: number | undefined;
  /** ⌘/Ctrl + K：打開連結列。只在開放連結時註冊。 */
  onLinkShortcut: (editor: Editor) => void;
}

/**
 * 組出編輯器的 extension。關掉的格式不只是隱藏按鈕，而是 **不進 schema**：
 * 貼上的 HTML 也只會留下允許的節點與標記（docs/architecture/frontend/07-ui-system.md §3.16）。
 */
export function createRichTextExtensions({
  formats,
  maxLength,
  onLinkShortcut,
}: RichTextExtensionOptions): Extensions {
  const enabled = <T>(format: RichTextFormat, options: T): T | false =>
    formats.has(format) ? options : false;

  return [
    StarterKit.configure({
      bold: enabled('bold', {}),
      italic: enabled('italic', {}),
      underline: enabled('underline', {}),
      strike: enabled('strike', {}),
      code: enabled('code', {}),
      heading: enabled('heading', { levels: [...RICH_TEXT_HEADING_LEVELS] }),
      bulletList: enabled('bulletList', {}),
      orderedList: enabled('orderedList', {}),
      // 兩種清單都關掉時，清單項目與清單的快捷鍵也不需要
      listItem: formats.has('bulletList') || formats.has('orderedList') ? {} : false,
      listKeymap: formats.has('bulletList') || formats.has('orderedList') ? {} : false,
      blockquote: enabled('blockquote', {}),
      codeBlock: enabled('codeBlock', {}),
      horizontalRule: enabled('horizontalRule', {}),
      link: enabled('link', {
        openOnClick: false,
        autolink: true,
        linkOnPaste: true,
        defaultProtocol: 'https',
        // 貼上、輸入、setLink 與解析 HTML 都經過這個判斷；與 RichTextViewer 渲染時用的是同一個
        isAllowedUri: (url: string) => isSafeLinkHref(url),
        HTMLAttributes: { target: '_blank', rel: 'noopener noreferrer nofollow' },
      }),
      // gapcursor 要另外的樣式，這裡的節點（沒有圖片、表格）用不到
      gapcursor: false,
    }),
    // 提示文字取編輯區目前的 aria-placeholder：它跟著 props 更新（RichTextEditor 的 editorProps），不必重建編輯器
    Placeholder.configure({ placeholder: ({ editor }) => placeholderOf(editor) }),
    CharacterCount.configure({ limit: maxLength ?? null }),
    ...(formats.has('link') ? [linkShortcut(onLinkShortcut)] : []),
  ];
}

function linkShortcut(onLinkShortcut: (editor: Editor) => void) {
  return Extension.create({
    name: 'richTextLinkShortcut',
    addKeyboardShortcuts() {
      return {
        'Mod-k': ({ editor }) => {
          onLinkShortcut(editor);
          return true;
        },
      };
    },
  });
}

function placeholderOf(editor: Editor): string {
  const { attributes } = editor.options.editorProps;
  const value = typeof attributes === 'object' ? attributes['aria-placeholder'] : undefined;
  return value ?? '';
}
