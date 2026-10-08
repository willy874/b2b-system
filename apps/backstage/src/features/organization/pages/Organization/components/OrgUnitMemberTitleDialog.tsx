import { Button } from '@b2b-system/ui/Button';
import { Dialog } from '@b2b-system/ui/Dialog';
import { Field } from '@b2b-system/ui/Field';
import { Input } from '@b2b-system/ui/Input';
import { useTranslation } from '@b2b-system/web-core/locales';
import { useState } from 'react';

import type { OrgUnitMemberRowVM } from '../adapter';

interface OrgUnitMemberTitleDialogProps {
  /** 要編輯職稱的成員；`undefined` 時關閉。 */
  member: OrgUnitMemberRowVM | undefined;
  pending: boolean;
  /** 清空＝拿掉職稱（`null`）。 */
  onSubmit: (member: OrgUnitMemberRowVM, title: string | null) => Promise<unknown>;
  onClose: () => void;
}

/** 編輯成員在這個部門的職稱（自由文字，只用來顯示）。 */
export function OrgUnitMemberTitleDialog({
  member,
  pending,
  onSubmit,
  onClose,
}: OrgUnitMemberTitleDialogProps) {
  const { t } = useTranslation();
  const [title, setTitle] = useState('');
  const [openedFor, setOpenedFor] = useState<OrgUnitMemberRowVM>();
  // 每次開啟從目前的職稱開始（render 期間調整 state，不經過 effect）
  if (member !== openedFor) {
    setOpenedFor(member);
    setTitle(member?.title ?? '');
  }

  const submit = () => {
    if (!member) return;
    // 失敗時對話框留著（錯誤由 mutation 的 onError 顯示）
    void onSubmit(member, title.trim() || null).then(onClose, () => undefined);
  };

  return (
    <Dialog
      open={Boolean(member)}
      onOpenChange={(open) => !open && onClose()}
      title={t('organization.member.titleDialog', { name: member?.displayName ?? '' })}
      size="sm"
      data-testid="org-unit-member-title-dialog"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            loading={pending}
            onClick={submit}
            data-testid="org-unit-member-title-submit"
          >
            {t('common.save')}
          </Button>
        </>
      }
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <Field label={t('organization.member.title')}>
          <Input
            value={title}
            maxLength={64}
            onChange={(event) => setTitle(event.target.value)}
            data-testid="org-unit-member-title-input"
          />
        </Field>
      </form>
    </Dialog>
  );
}
