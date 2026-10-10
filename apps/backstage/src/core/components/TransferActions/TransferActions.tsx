import { Button, ButtonLink } from '@b2b-system/ui/Button';
import { Icon } from '@b2b-system/ui/Icon';
import { Menu } from '@b2b-system/ui/Menu';
import { useTranslation } from '@b2b-system/web-core/locales';
import { useNavigate } from '@tanstack/react-router';

/**
 * 一種可以匯出或匯入的資料：按了就開匯出對話框（`onSelect`），或前往匯入頁（`to` ＋ `search`）。
 * `label` 是多種資料時選單項目的名稱；只有一種時是按鈕，不需要。
 */
export type TransferAction = { key: string; label?: string } & (
  | { onSelect: () => void; to?: undefined }
  | { to: string; search?: Record<string, unknown>; onSelect?: undefined }
);

interface TransferActionsProps {
  /** 可以匯出的資料；空的時候不顯示「匯出」（沒有權限時由呼叫端傳空陣列）。 */
  exports?: readonly TransferAction[];
  /** 可以匯入的資料；同上。 */
  imports?: readonly TransferAction[];
  /** 各按鈕與選單的 testid，由呼叫端寫完整字面量（docs/coding-standards/06-literal-strings.md §3.3）。 */
  testIds: {
    exportButton?: string;
    exportMenu?: string;
    importButton?: string;
    importMenu?: string;
  };
}

/**
 * 列表頁頁首的「匯出」「匯入」（docs/architecture/frontend/21-data-transfer.md）：只有一種資料時是按鈕（匯入是連結），
 * 多種（例：群組與群組成員）時是下拉選單。權限由呼叫端決定傳不傳。
 */
export function TransferActions({ exports = [], imports = [], testIds }: TransferActionsProps) {
  const { t } = useTranslation();
  return (
    <>
      <TransferButton
        actions={exports}
        icon="download"
        label={t('dataTransfer.export.action')}
        buttonTestId={testIds.exportButton}
        menuTestId={testIds.exportMenu}
      />
      <TransferButton
        actions={imports}
        icon="upload"
        label={t('dataTransfer.import.action')}
        buttonTestId={testIds.importButton}
        menuTestId={testIds.importMenu}
      />
    </>
  );
}

interface TransferButtonProps {
  actions: readonly TransferAction[];
  icon: 'download' | 'upload';
  label: string;
  buttonTestId?: string;
  menuTestId?: string;
}

function TransferButton({ actions, icon, label, buttonTestId, menuTestId }: TransferButtonProps) {
  const navigate = useNavigate();
  const [only] = actions;
  if (!only) return null;
  if (actions.length === 1) {
    return only.to !== undefined ? (
      <ButtonLink
        variant="secondary"
        to={only.to}
        search={only.search as never}
        startIcon={<Icon name={icon} size={16} />}
        data-testid={buttonTestId}
      >
        {label}
      </ButtonLink>
    ) : (
      <Button
        variant="secondary"
        startIcon={<Icon name={icon} size={16} />}
        onClick={only.onSelect}
        data-testid={buttonTestId}
      >
        {label}
      </Button>
    );
  }
  return (
    <Menu
      align="end"
      trigger={
        <Button
          variant="secondary"
          startIcon={<Icon name={icon} size={16} />}
          endIcon={<Icon name="chevron-down" size={14} />}
          data-testid={buttonTestId}
        >
          {label}
        </Button>
      }
      items={actions.map((action) => ({
        key: action.key,
        label: action.label ?? action.key,
        onSelect: () =>
          action.to !== undefined
            ? void navigate({ to: action.to, search: action.search as never })
            : action.onSelect(),
      }))}
      data-testid={menuTestId}
    />
  );
}
