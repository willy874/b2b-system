import type { RichTextFormat } from '@b2b-system/rich-text';
import type { ChainedCommands, Editor } from '@tiptap/core';

import { Icon } from '../Icon';
import type { IconName } from '../Icon';
import type { RichTextEditorTextLabels } from '../labels';
import type { ToolbarItem } from '../Toolbar';

/** 會切換開關的格式按鈕（連結另外處理：它要打開連結列）。 */
interface FormatButton {
  /** 工具列按鈕的 `data-value`。 */
  key: string;
  format: RichTextFormat;
  icon: IconName;
  label: Exclude<keyof RichTextEditorTextLabels, 'characterCount'>;
  isActive: (editor: Editor) => boolean;
  /** 在 `editor.can()` 或 `editor.chain()` 上套用；`can()` 版本判斷目前能不能按。 */
  apply: (chain: ChainedCommands) => ChainedCommands;
}

/** 工具列的順序：行內格式 → 標題 → 區塊。 */
export const FORMAT_BUTTONS: readonly FormatButton[] = [
  {
    key: 'bold',
    format: 'bold',
    icon: 'bold',
    label: 'bold',
    isActive: (editor) => editor.isActive('bold'),
    apply: (chain) => chain.toggleBold(),
  },
  {
    key: 'italic',
    format: 'italic',
    icon: 'italic',
    label: 'italic',
    isActive: (editor) => editor.isActive('italic'),
    apply: (chain) => chain.toggleItalic(),
  },
  {
    key: 'underline',
    format: 'underline',
    icon: 'underline',
    label: 'underline',
    isActive: (editor) => editor.isActive('underline'),
    apply: (chain) => chain.toggleUnderline(),
  },
  {
    key: 'strike',
    format: 'strike',
    icon: 'strikethrough',
    label: 'strike',
    isActive: (editor) => editor.isActive('strike'),
    apply: (chain) => chain.toggleStrike(),
  },
  {
    key: 'code',
    format: 'code',
    icon: 'code',
    label: 'code',
    isActive: (editor) => editor.isActive('code'),
    apply: (chain) => chain.toggleCode(),
  },
  {
    key: 'heading-2',
    format: 'heading',
    icon: 'heading-2',
    label: 'heading2',
    isActive: (editor) => editor.isActive('heading', { level: 2 }),
    apply: (chain) => chain.toggleHeading({ level: 2 }),
  },
  {
    key: 'heading-3',
    format: 'heading',
    icon: 'heading-3',
    label: 'heading3',
    isActive: (editor) => editor.isActive('heading', { level: 3 }),
    apply: (chain) => chain.toggleHeading({ level: 3 }),
  },
  {
    key: 'bullet-list',
    format: 'bulletList',
    icon: 'list',
    label: 'bulletList',
    isActive: (editor) => editor.isActive('bulletList'),
    apply: (chain) => chain.toggleBulletList(),
  },
  {
    key: 'ordered-list',
    format: 'orderedList',
    icon: 'list-ordered',
    label: 'orderedList',
    isActive: (editor) => editor.isActive('orderedList'),
    apply: (chain) => chain.toggleOrderedList(),
  },
  {
    key: 'blockquote',
    format: 'blockquote',
    icon: 'quote',
    label: 'blockquote',
    isActive: (editor) => editor.isActive('blockquote'),
    apply: (chain) => chain.toggleBlockquote(),
  },
  {
    key: 'code-block',
    format: 'codeBlock',
    icon: 'code-block',
    label: 'codeBlock',
    isActive: (editor) => editor.isActive('codeBlock'),
    apply: (chain) => chain.toggleCodeBlock(),
  },
  {
    key: 'horizontal-rule',
    format: 'horizontalRule',
    icon: 'minus',
    label: 'horizontalRule',
    // 插入，不是開關
    isActive: () => false,
    apply: (chain) => chain.setHorizontalRule(),
  },
];

/** 工具列需要的編輯器狀態；以 `useEditorState` 訂閱，只有這些值變了才重新渲染。 */
export interface RichTextToolbarState {
  /** 以 `FormatButton.key` 為鍵。 */
  active: Record<string, boolean>;
  /** 以 `FormatButton.key` 為鍵：目前的選取範圍能不能套用（例如程式碼區塊裡不能加粗）。 */
  enabled: Record<string, boolean>;
  isLinkActive: boolean;
  canUndo: boolean;
  canRedo: boolean;
}

/** 沒有可用的編輯器（重建、暫時藏起來的空檔）時的狀態：全部停用。 */
export const INACTIVE_TOOLBAR_STATE: RichTextToolbarState = {
  active: {},
  enabled: {},
  isLinkActive: false,
  canUndo: false,
  canRedo: false,
};

export function selectToolbarState(
  editor: Editor,
  formats: ReadonlySet<RichTextFormat>,
): RichTextToolbarState {
  // 銷毀後 Tiptap 清掉了 commandManager，`can()` 會丟出錯誤；新的編輯器建立後會再算一次
  if (editor.isDestroyed) return INACTIVE_TOOLBAR_STATE;
  const active: Record<string, boolean> = {};
  const enabled: Record<string, boolean> = {};
  for (const button of FORMAT_BUTTONS) {
    if (!formats.has(button.format)) continue;
    active[button.key] = button.isActive(editor);
    enabled[button.key] = button.apply(editor.can().chain()).run();
  }
  return {
    active,
    enabled,
    isLinkActive: formats.has('link') && editor.isActive('link'),
    canUndo: editor.can().undo(),
    canRedo: editor.can().redo(),
  };
}

export interface RichTextToolbarOptions {
  formats: ReadonlySet<RichTextFormat>;
  labels: RichTextEditorTextLabels;
  state: RichTextToolbarState;
  disabled: boolean;
  onFormat: (button: FormatButton) => void;
  onLink: () => void;
  onUndo: () => void;
  onRedo: () => void;
}

/** 格式按鈕都只顯示圖示（`label` 是名稱與提示）；復原／重做靠右。放不下時從尾端收進「更多」。 */
export function richTextToolbarItems({
  formats,
  labels,
  state,
  disabled,
  onFormat,
  onLink,
  onUndo,
  onRedo,
}: RichTextToolbarOptions): ToolbarItem[] {
  const formatItems = FORMAT_BUTTONS.filter((button) => formats.has(button.format)).map(
    (button): ToolbarItem => ({
      key: button.key,
      label: labels[button.label],
      icon: <Icon name={button.icon} size={16} />,
      iconOnly: true,
      // 插入類（分隔線）不是開關，不帶 aria-pressed
      pressed: button.key === 'horizontal-rule' ? undefined : (state.active[button.key] ?? false),
      disabled: disabled || !state.enabled[button.key],
      onClick: () => onFormat(button),
    }),
  );
  const linkItem: ToolbarItem[] = formats.has('link')
    ? [
        {
          key: 'link',
          label: labels.link,
          icon: <Icon name="link" size={16} />,
          iconOnly: true,
          pressed: state.isLinkActive,
          disabled,
          onClick: onLink,
        },
      ]
    : [];
  return [
    ...formatItems,
    ...linkItem,
    {
      key: 'undo',
      label: labels.undo,
      icon: <Icon name="undo" size={16} />,
      iconOnly: true,
      align: 'end',
      disabled: disabled || !state.canUndo,
      onClick: onUndo,
    },
    {
      key: 'redo',
      label: labels.redo,
      icon: <Icon name="redo" size={16} />,
      iconOnly: true,
      align: 'end',
      disabled: disabled || !state.canRedo,
      onClick: onRedo,
    },
  ];
}
