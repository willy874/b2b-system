import type { RichTextDocument } from '@b2b-system/rich-text';

/** Storybook 用的範例文件（兩個元件的 story 共用）：每種格式都出現一次，內容領域中立。 */
export const SAMPLE_RICH_TEXT_DOCUMENT: RichTextDocument = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '每週例會' }] },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: '本週重點：' },
        { type: 'text', text: '新版上線', marks: [{ type: 'bold' }] },
        { type: 'text', text: '、' },
        { type: 'text', text: '文件更新', marks: [{ type: 'italic' }] },
        { type: 'text', text: '，' },
        { type: 'text', text: '舊流程', marks: [{ type: 'strike' }] },
        { type: 'text', text: '停用。設定值改為 ' },
        { type: 'text', text: 'timeout = 30', marks: [{ type: 'code' }] },
        { type: 'text', text: '，詳見' },
        {
          type: 'text',
          text: '說明文件',
          marks: [{ type: 'link', attrs: { href: 'https://example.com/docs' } }],
        },
        { type: 'text', text: '。' },
      ],
    },
    { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: '待辦' }] },
    {
      type: 'orderedList',
      attrs: { start: 1 },
      content: [
        {
          type: 'listItem',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: '確認上線時間' }] }],
        },
        {
          type: 'listItem',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: '通知相關人員' }] },
            {
              type: 'bulletList',
              content: [
                {
                  type: 'listItem',
                  content: [{ type: 'paragraph', content: [{ type: 'text', text: '內部團隊' }] }],
                },
                {
                  type: 'listItem',
                  content: [{ type: 'paragraph', content: [{ type: 'text', text: '合作夥伴' }] }],
                },
              ],
            },
          ],
        },
      ],
    },
    {
      type: 'blockquote',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: '上線前一天凍結變更。', marks: [{ type: 'underline' }] }],
        },
      ],
    },
    {
      type: 'codeBlock',
      attrs: { language: null },
      content: [{ type: 'text', text: 'deploy --env production\nverify --all' }],
    },
    { type: 'horizontalRule' },
    { type: 'paragraph', content: [{ type: 'text', text: '下次會議：週四上午十點。' }] },
  ],
};
