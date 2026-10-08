import { EMPTY_RICH_TEXT_DOCUMENT, RICH_TEXT_FORMATS } from '@b2b-system/rich-text';
import type { RichTextDocument, RichTextFormat } from '@b2b-system/rich-text';
import { cn } from '@b2b-system/web-shared/utils';
import type { Editor } from '@tiptap/core';
import { getSchema } from '@tiptap/core';
import { EditorState } from '@tiptap/pm/state';
import { EditorContent, useEditor, useEditorState } from '@tiptap/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, Ref } from 'react';

import { useFieldControl } from '../Field/fieldControl';
import { useComponentLabels } from '../labels';
import type { RichTextEditorTextLabels } from '../labels';
import { createSlots } from '../slots';
import type { SlotOverrides } from '../slots';
import { Toolbar } from '../Toolbar';
import { useControllableState } from '../useControllableState';
import { useLatestRef } from '../useLatestRef';
import { fitToSchema } from './fitToSchema';
import { LinkBar } from './LinkBar';
import { createRichTextExtensions } from './richTextExtensions';
import {
  INACTIVE_TOOLBAR_STATE,
  richTextToolbarItems,
  selectToolbarState,
} from './richTextToolbar';

import content from '../RichTextViewer/richTextContent.module.css';
import styles from './RichTextEditor.module.css';

/**
 * `className` / `data-testid` 落在最外層；其餘各層用 `classNames` / `styles` / `testIds` 覆寫。
 * `link`：編輯連結的那一列（打開時才出現）；`content`：編輯區的捲動框；`footer`：字數（設了 `maxLength` 才有）。
 */
export type RichTextEditorSlot = 'toolbar' | 'link' | 'content' | 'footer';

export interface RichTextEditorProps extends SlotOverrides<RichTextEditorSlot> {
  /** 透傳到最外層（React 19 的 ref 是一般 prop）。 */
  ref?: Ref<HTMLDivElement>;
  /**
   * 受控的值（ProseMirror 的文件 JSON）。每次編輯以 `onChange` 回報新的文件；
   * 傳入的值與最後一次回報的不是同一個參考時，整份內容重新產生（復原紀錄與游標會重設）。
   */
  value?: RichTextDocument;
  defaultValue?: RichTextDocument;
  onChange?: (value: RichTextDocument) => void;
  /** 焦點離開編輯區（表單用來標記 touched）。 */
  onBlur?: () => void;
  /**
   * 開放的格式，預設全部（`RICH_TEXT_FORMATS`）。沒開放的格式不只沒有按鈕，貼上的內容也會被拿掉。
   * 內容改變時會重建編輯器（復原紀錄會清空），請保持固定。
   */
  formats?: readonly RichTextFormat[];
  placeholder?: string;
  /** 字數上限（純文字的字元數）：到上限後不能再輸入，編輯區下方顯示字數。 */
  maxLength?: number;
  /** 只能看、選取與複製；不顯示工具列。 */
  readOnly?: boolean;
  /** 停用：不能編輯，工具列的按鈕也停用（表單送出中）。 */
  disabled?: boolean;
  /** 錯誤狀態（外框變色、編輯區 `aria-invalid`）；放在帶 `error` 的 `Field` 裡時自動成立。 */
  invalid?: boolean;
  /** 編輯區的最小高度（預設 `6rem`）。 */
  minHeight?: CSSProperties['minHeight'];
  /** 編輯區的最大高度（預設 `20rem`），超過在框內捲動。 */
  maxHeight?: CSSProperties['maxHeight'];
  /** 預設文案來自 `ComponentLabelsContext`（跟著語系）；個別覆寫時傳入。 */
  labels?: Partial<RichTextEditorTextLabels>;
  className?: string;
  style?: CSSProperties;
  /** 編輯區（`role="textbox"`）的名稱；放在 `Field` 裡、沒有傳時以 `Field` 的標籤命名。 */
  'aria-label'?: string;
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
  'data-testid'?: string;
}

const DEFAULT_MIN_HEIGHT = '6rem';
const DEFAULT_MAX_HEIGHT = '20rem';

/**
 * 富文本編輯器，底層是 Tiptap 3（ProseMirror）：粗體、斜體、底線、刪除線、行內程式碼、兩層標題、清單、引言、
 * 程式碼區塊、分隔線、連結（⌘/Ctrl + K），復原／重做（⌘/Ctrl + Z、⌘/Ctrl + Shift + Z），貼上時只留允許的格式。
 * 值是 ProseMirror 的文件 JSON，唯讀顯示用 `RichTextViewer`（不載入編輯器）。
 * Tiptap 的設定在 `richTextExtensions.ts`、工具列在 `richTextToolbar.tsx`；這裡只處理 props 與狀態同步
 * （docs/architecture/frontend/07-ui-system.md §3.16）。
 */
export function RichTextEditor({
  ref,
  value: valueProp,
  defaultValue = EMPTY_RICH_TEXT_DOCUMENT,
  onChange,
  onBlur,
  formats: formatsProp = RICH_TEXT_FORMATS,
  placeholder = '',
  maxLength,
  readOnly = false,
  disabled = false,
  invalid = false,
  minHeight = DEFAULT_MIN_HEIGHT,
  maxHeight = DEFAULT_MAX_HEIGHT,
  labels: labelsProp,
  className,
  style,
  classNames,
  styles: styleOverrides,
  testIds,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  'aria-describedby': ariaDescribedBy,
  ...rest
}: RichTextEditorProps) {
  const slot = createSlots({ classNames, styles: styleOverrides, testIds });
  const labels: RichTextEditorTextLabels = {
    ...useComponentLabels().richTextEditor,
    ...labelsProp,
  };
  const field = useFieldControl();
  const isInvalid = invalid || Boolean(field?.invalid);
  const isEditable = !readOnly && !disabled;

  // 以內容（不是參考）判斷格式有沒有變：呼叫端每次 render 傳新陣列也不會重建編輯器
  const formatsKey = formatsProp.join(',');
  const formats = useMemo<ReadonlySet<RichTextFormat>>(
    () => new Set(formatsKey.split(',') as RichTextFormat[]),
    [formatsKey],
  );

  const [value, setValue] = useControllableState(valueProp, defaultValue, onChange);
  /** 編輯器目前內容對應的值：自己回報出去的值回到 props 時不重建內容。 */
  const documentValue = useRef(value);
  const [linkHref, setLinkHref] = useState<string>();

  const onBlurRef = useLatestRef(onBlur);
  const setValueRef = useLatestRef(setValue);
  const extensions = useMemo(
    () =>
      createRichTextExtensions({
        formats,
        maxLength,
        onLinkShortcut: (current) => setLinkHref(currentLinkHref(current)),
      }),
    [formats, maxLength],
  );
  /** 內容先整理成這組格式接受的形狀（只在建立編輯器時用到；之後的外部換值走 resetDocument）。 */
  const schema = useMemo(() => getSchema(extensions), [extensions]);
  const initialContent = useMemo(() => fitToSchema(value, schema).toJSON(), [value, schema]);

  // 編輯區（ProseMirror 的 contenteditable）的屬性：ARIA 跟著 props 與 Field 變，只能經由 editorProps 設定
  const labelledBy = ariaLabelledBy ?? (ariaLabel ? undefined : field?.labelId);
  const describedBy = [ariaDescribedBy, field?.describedBy].filter(Boolean).join(' ') || undefined;
  const controlId = field?.controlId;
  const attributes = useMemo(
    () =>
      editableAttributes({
        id: controlId,
        'aria-label': ariaLabel,
        'aria-labelledby': labelledBy,
        'aria-describedby': describedBy,
        'aria-invalid': isInvalid,
        'aria-readonly': readOnly,
        'aria-disabled': disabled,
        'aria-placeholder': placeholder || undefined,
      }),
    [controlId, ariaLabel, labelledBy, describedBy, isInvalid, readOnly, disabled, placeholder],
  );

  /*
   * Tiptap 在編輯器沒有掛載時（外層 Suspense 顯示 fallback、`<Activity mode="hidden">`、StrictMode）會銷毀它並回傳 null，
   * 重新顯示時才建新的；這段空檔裡元件仍可能 render。型別宣稱一定有值，這裡收斂成「可用的編輯器或 null」。
   */
  const instance: Editor | null = useEditor(
    {
      extensions,
      content: initialContent,
      editable: isEditable,
      // 樣式全部在 CSS Module（@layer components）；Tiptap 自己插入的 <style> 不分層，會蓋過設計系統
      injectCSS: false,
      // 工具列以 useEditorState 訂閱需要的狀態，每次 transaction 不必整個元件重新渲染
      shouldRerenderOnTransaction: false,
      // 重建編輯器、StrictMode 重新掛載時 Tiptap 會以最後一次的 options 重設，所以這裡也要帶最新的屬性
      editorProps: { attributes },
      onUpdate: ({ editor: updated }) => {
        // ProseMirror 的 toJSON 一定帶 `type`，根節點一定是 doc；Tiptap 的 JSONContent 型別把它們標成選填
        const next = updated.getJSON() as RichTextDocument;
        documentValue.current = next;
        setValueRef.current(next);
      },
      onBlur: () => onBlurRef.current?.(),
    },
    // 格式與字數上限決定 schema 與 extension，改變時重建編輯器（內容取當下的 value）
    [extensions],
  );
  const editor = instance && !instance.isDestroyed ? instance : null;

  // 外部換了值（不是剛才自己回報的那一個）：整份內容重新產生，復原紀錄一併清空
  useEffect(() => {
    if (!editor || Object.is(value, documentValue.current)) return;
    documentValue.current = value;
    resetDocument(editor, value);
  }, [editor, value]);

  useEffect(() => {
    // 第二個參數 false：切換唯讀不是內容的變更，不觸發 onUpdate（否則會回報一次相同的內容）
    if (editor && editor.isEditable !== isEditable) editor.setEditable(isEditable, false);
  }, [editor, isEditable]);

  useEffect(() => {
    if (!editor) return;
    editor.setOptions({ editorProps: { attributes } });
    // Placeholder 讀的是 aria-placeholder（例如切換語系後換了提示）：送一個空的 transaction 讓它重畫
    editor.view.dispatch(editor.state.tr.setMeta('addToHistory', false));
  }, [editor, attributes]);

  const toolbarState =
    useEditorState({
      editor,
      selector: ({ editor: current }) =>
        current ? selectToolbarState(current, formats) : INACTIVE_TOOLBAR_STATE,
    }) ?? INACTIVE_TOOLBAR_STATE;
  const characters =
    useEditorState({
      editor,
      // 銷毀後 Tiptap 清空了 storage：訂閱可能在元件重新 render 之前對舊的編輯器再算一次
      selector: ({ editor: current }) =>
        current && !current.isDestroyed ? current.storage.characterCount.characters() : 0,
    }) ?? 0;

  const openLink = () => {
    if (editor && isEditable && formats.has('link')) setLinkHref(currentLinkHref(editor));
  };

  const closeLink = () => {
    setLinkHref(undefined);
    editor?.commands.focus();
  };

  const applyLink = (href: string) => {
    setLinkHref(undefined);
    if (!editor) return;
    const chain = editor.chain().focus();
    if (editor.state.selection.empty && !editor.isActive('link')) {
      // 沒有選取文字：插入網址本身當作連結文字
      chain.insertContent({ type: 'text', text: href, marks: [{ type: 'link', attrs: { href } }] });
    } else {
      chain.extendMarkRange('link').setLink({ href });
    }
    chain.run();
  };

  const removeLink = () => {
    setLinkHref(undefined);
    editor?.chain().focus().extendMarkRange('link').unsetLink().run();
  };

  const toolbarItems = richTextToolbarItems({
    formats,
    labels,
    state: toolbarState,
    disabled,
    onFormat: (button) => editor && button.apply(editor.chain().focus()).run(),
    onLink: openLink,
    onUndo: () => editor?.chain().focus().undo().run(),
    onRedo: () => editor?.chain().focus().redo().run(),
  });

  return (
    <div
      ref={ref}
      className={cn(styles.root, className)}
      style={
        {
          '--rich-text-editor-min-height': toCssLength(minHeight),
          '--rich-text-editor-max-height': toCssLength(maxHeight),
          ...style,
        } as CSSProperties
      }
      data-readonly={readOnly || undefined}
      data-disabled={disabled || undefined}
      data-invalid={isInvalid || undefined}
      {...rest}
    >
      {!readOnly && (
        <div {...slot('toolbar', styles.toolbar, { testId: 'rich-text-editor-toolbar' })}>
          <Toolbar items={toolbarItems} moreLabel={labels.more} />
        </div>
      )}

      {linkHref !== undefined && (
        <LinkBar
          labels={labels}
          initialHref={linkHref}
          onApply={applyLink}
          onRemove={linkHref ? removeLink : undefined}
          onCancel={closeLink}
          slotAttributes={slot('link', styles.link, { testId: 'rich-text-editor-link' })}
        />
      )}

      <EditorContent
        editor={editor}
        {...slot('content', styles.content, { testId: 'rich-text-editor-content' })}
      />

      {maxLength !== undefined && (
        <div
          {...slot('footer', styles.footer, { testId: 'rich-text-editor-footer' })}
          data-full={characters >= maxLength || undefined}
          aria-live="polite"
        >
          {labels.characterCount(characters, maxLength)}
        </div>
      )}
    </div>
  );
}

/** 游標所在的連結的網址；不在連結上時是空字串（連結列以它判斷要不要顯示「移除連結」）。 */
function currentLinkHref(editor: Editor): string {
  const href: unknown = editor.getAttributes('link').href;
  return typeof href === 'string' ? href : '';
}

/** 換成全新的文件：新的 EditorState 沒有復原紀錄，也不會觸發 `onUpdate`（不回報給呼叫端）。 */
function resetDocument(editor: Editor, value: RichTextDocument) {
  const state = EditorState.create({
    doc: fitToSchema(value, editor.schema),
    plugins: editor.state.plugins,
  });
  editor.view.updateState(state);
  // updateState 不經過 transaction：補一個空的，讓訂閱編輯器狀態的工具列與字數更新
  editor.view.dispatch(editor.state.tr.setMeta('addToHistory', false));
}

/** ProseMirror 編輯區的屬性：class 與 textbox 語意固定，ARIA 只放有值的（`false`／`undefined` 不輸出）。 */
function editableAttributes(
  aria: Record<string, string | boolean | undefined>,
): Record<string, string> {
  const attributes: Record<string, string> = {
    class: cn(content.content, styles.editable),
    role: 'textbox',
    'aria-multiline': 'true',
  };
  for (const [name, value] of Object.entries(aria)) {
    if (value === undefined || value === false) continue;
    attributes[name] = value === true ? 'true' : value;
  }
  return attributes;
}

/** 長度是數字時與 React 的 style 一樣視為 px。 */
function toCssLength(length: CSSProperties['maxHeight']): string | undefined {
  return typeof length === 'number' ? `${length}px` : length;
}
