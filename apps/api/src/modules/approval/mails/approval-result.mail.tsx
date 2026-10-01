import { Button, Text } from 'react-email';

import { MAIL_FOOTER, MAIL_STYLES, MailLayout } from '@/core/mail';
import type { MailContent, MailLocale } from '@/core/mail';

import { ApprovalType } from '../approval.constants';

/** 申請類型在信裡的名稱。新增審批類型時補一列；沒補的退回通用名稱。 */
const TYPE_LABEL: Partial<Record<ApprovalType, Record<MailLocale, string>>> = {
  [ApprovalType.USER_REGISTER]: { 'zh-TW': '帳號申請', 'en-US': 'account registration' },
  [ApprovalType.FILE_FOLDER_ACCESS]: {
    'zh-TW': '資料夾存取申請',
    'en-US': 'folder access request',
  },
};

const GENERIC_LABEL = { 'zh-TW': '申請', 'en-US': 'request' } as const satisfies Record<
  MailLocale,
  string
>;

const COPY = {
  'zh-TW': {
    subject: (label: string, approved: boolean) => `你的${label}${approved ? '已核准' : '未通過'}`,
    body: (label: string, approved: boolean) =>
      approved ? `你送出的${label}已經核准。` : `你送出的${label}未通過審核。`,
    subjectLabel: '申請項目：',
    comment: '審核意見：',
    open: '開啟 B2B System',
  },
  'en-US': {
    subject: (label: string, approved: boolean) =>
      `Your ${label} was ${approved ? 'approved' : 'declined'}`,
    body: (label: string, approved: boolean) =>
      approved ? `Your ${label} has been approved.` : `Your ${label} was not approved.`,
    subjectLabel: 'Request: ',
    comment: 'Reviewer comment: ',
    open: 'Open B2B System',
  },
} as const;

export interface ApprovalResultMailProps {
  locale: MailLocale;
  type: string;
  approved: boolean;
  /** 申請的對象（例：資料夾名稱）；沒有就不顯示 */
  subjectName: string | null;
  comment: string | null;
  link: string;
}

export function approvalResultMail({
  locale,
  type,
  approved,
  subjectName,
  comment,
  link,
}: ApprovalResultMailProps): MailContent {
  const copy = COPY[locale];
  const label = TYPE_LABEL[type as ApprovalType]?.[locale] ?? GENERIC_LABEL[locale];
  const subject = copy.subject(label, approved);
  return {
    subject,
    body: (
      <MailLayout locale={locale} preview={subject} footer={MAIL_FOOTER[locale]}>
        <Text style={MAIL_STYLES.text}>{copy.body(label, approved)}</Text>
        {subjectName && (
          <Text style={MAIL_STYLES.text}>
            {copy.subjectLabel}
            {subjectName}
          </Text>
        )}
        {comment && (
          <Text style={MAIL_STYLES.text}>
            {copy.comment}
            {comment}
          </Text>
        )}
        <Button href={link} style={MAIL_STYLES.button}>
          {copy.open}
        </Button>
      </MailLayout>
    ),
  };
}
