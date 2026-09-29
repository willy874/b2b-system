import { Button, Link, Text } from '@react-email/components';

import { MAIL_FOOTER, MAIL_STYLES, MailLayout } from '@/core/mail';
import type { MailContent, MailLocale } from '@/core/mail';

interface WorkspaceInvitationCopy {
  subject: (workspace: string) => string;
  preview: string;
  body: (inviter: string | null, workspace: string) => string;
  expiry: (days: number) => string;
  action: string;
  fallback: string;
  ignore: string;
}

const COPY = {
  'zh-TW': {
    subject: (workspace) => `邀請你加入 B2B System 工作區：${workspace}`,
    preview: '點連結接受邀請',
    body: (inviter, workspace) =>
      inviter
        ? `${inviter} 邀請你加入 B2B System 的工作區「${workspace}」。`
        : `你受邀加入 B2B System 的工作區「${workspace}」。`,
    expiry: (days) =>
      `請在 ${days} 天內點下方按鈕接受邀請。已有帳號的話請用這個信箱的帳號登入；還沒有帳號的話，可以直接設定密碼建立帳號。`,
    action: '接受邀請',
    fallback: '按鈕無法使用時，請把這個網址貼到瀏覽器：',
    ignore: '如果你沒有預期收到這封信，可以直接忽略。',
  },
  'en-US': {
    subject: (workspace) => `You're invited to a B2B System workspace: ${workspace}`,
    preview: 'Follow the link to accept the invitation',
    body: (inviter, workspace) =>
      inviter
        ? `${inviter} invited you to join the "${workspace}" workspace on B2B System.`
        : `You have been invited to join the "${workspace}" workspace on B2B System.`,
    expiry: (days) =>
      `Accept the invitation within ${days} days. If you already have an account, sign in with this email address; otherwise you can set a password to create one.`,
    action: 'Accept invitation',
    fallback: 'If the button does not work, paste this address into your browser:',
    ignore: 'If you were not expecting this email, you can ignore it.',
  },
} as const satisfies Record<MailLocale, WorkspaceInvitationCopy>;

export interface WorkspaceInvitationMailProps {
  locale: MailLocale;
  workspaceName: string;
  /** 邀請人已被刪除時為 null。 */
  inviterName: string | null;
  link: string;
  /** 連結有效的天數（與邀請的 TTL 一致） */
  validDays: number;
}

/** 工作區邀請信（docs/adr/0018-workspace-tenancy.md D14）。 */
export function workspaceInvitationMail({
  locale,
  workspaceName,
  inviterName,
  link,
  validDays,
}: WorkspaceInvitationMailProps): MailContent {
  const copy: WorkspaceInvitationCopy = COPY[locale];
  return {
    subject: copy.subject(workspaceName),
    body: (
      <MailLayout locale={locale} preview={copy.preview} footer={MAIL_FOOTER[locale]}>
        <Text style={MAIL_STYLES.text}>{copy.body(inviterName, workspaceName)}</Text>
        <Text style={MAIL_STYLES.text}>{copy.expiry(validDays)}</Text>
        <Button href={link} style={MAIL_STYLES.button}>
          {copy.action}
        </Button>
        <Text style={MAIL_STYLES.muted}>
          {copy.fallback}
          <br />
          <Link href={link}>{link}</Link>
        </Text>
        <Text style={MAIL_STYLES.muted}>{copy.ignore}</Text>
      </MailLayout>
    ),
  };
}
