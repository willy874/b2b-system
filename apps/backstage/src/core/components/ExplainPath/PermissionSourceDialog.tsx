import { Dialog } from '@b2b-system/ui/Dialog';
import { Spinner } from '@b2b-system/ui/Spinner';
import { QueryError } from '@b2b-system/web-core/components';
import { useTranslation } from '@b2b-system/web-core/locales';
import { useState } from 'react';

import type { PermissionSources } from '@/shared/api-sdk';

import { PermissionSourceList } from './PermissionSourceList';
import { PermissionSourceViewer } from './PermissionSourceViewer';

interface PermissionSourceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 誰的有效權限（顯示在標題下方）。 */
  description?: string;
  data: PermissionSources | undefined;
  error: unknown;
  onRetry: () => void;
}

/**
 * 有效權限與來源（docs/architecture/iam/01-model.md §9 G4b）的兩層對話框：第一層是清單，點一個權限再疊一層看它的路徑。
 * 關掉第二層回到清單，搜尋與捲動位置都還在。資料由呼叫端查（打開時才查），core 不碰 `apis/`。
 */
export function PermissionSourceDialog({
  open,
  onOpenChange,
  description,
  data,
  error,
  onRetry,
}: PermissionSourceDialogProps) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<PermissionSources['items'][number]>();

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={t('explain.list.title')}
      description={description}
      data-testid="permission-source-dialog"
    >
      {data ? (
        <PermissionSourceList data={data} onSelect={setSelected} />
      ) : error ? (
        <QueryError error={error} onRetry={onRetry} />
      ) : (
        <Spinner size={16} />
      )}
      <Dialog
        open={selected !== undefined}
        onOpenChange={(next) => {
          if (!next) setSelected(undefined);
        }}
        title={selected?.key ?? ''}
        description={t('explain.viewer.description')}
        data-testid="permission-source-viewer-dialog"
      >
        {selected && <PermissionSourceViewer item={selected} />}
      </Dialog>
    </Dialog>
  );
}
