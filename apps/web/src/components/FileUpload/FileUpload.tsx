import { useId, useRef, useState } from 'react';
import type { ChangeEvent, DragEvent, Ref } from 'react';

import { cn } from '@/shared/utils';

import { IconButton } from '../Button';
import { Icon } from '../Icon';

import './FileUpload.css';

export interface FileUploadLabels {
  hint: string;
  browse: string;
  remove: string;
  tooLarge: string;
  wrongType: string;
}

export interface FileUploadProps {
  /** 透傳到根元素（React 19 的 ref 是一般 prop）。 */
  ref?: Ref<HTMLDivElement>;
  files: File[];
  onFilesChange: (files: File[]) => void;
  /** 例：`image/png,image/jpeg` 或 `.csv`。 */
  accept?: string;
  multiple?: boolean;
  /** 單檔大小上限（bytes）。 */
  maxSize?: number;
  disabled?: boolean;
  className?: string;
  labels?: Partial<FileUploadLabels>;
  onRejected?: (rejections: Array<{ file: File; reason: 'size' | 'type' }>) => void;
  'aria-label'?: string;
  'data-testid'?: string;
}

const DEFAULT_LABELS: FileUploadLabels = {
  hint: '把檔案拖曳到這裡，或',
  browse: '選擇檔案',
  remove: '移除',
  tooLarge: '檔案太大',
  wrongType: '不支援的檔案類型',
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function matchesAccept(file: File, accept?: string): boolean {
  if (!accept) return true;
  return accept.split(',').some((pattern) => {
    const value = pattern.trim().toLowerCase();
    if (!value) return true;
    if (value.startsWith('.')) return file.name.toLowerCase().endsWith(value);
    if (value.endsWith('/*')) return file.type.startsWith(value.slice(0, -1));
    return file.type.toLowerCase() === value;
  });
}

/** 原生 `<input type="file">` ＋ 拖放。檔案只留在記憶體，上傳由呼叫端負責。 */
export function FileUpload({
  files,
  onFilesChange,
  accept,
  multiple,
  maxSize,
  disabled,
  className,
  labels: labelOverrides,
  onRejected,
  ...rest
}: FileUploadProps) {
  const labels = { ...DEFAULT_LABELS, ...labelOverrides };
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  const accept_ = (incoming: FileList | null) => {
    if (!incoming) return;
    const accepted: File[] = [];
    const rejected: Array<{ file: File; reason: 'size' | 'type' }> = [];

    for (const file of incoming) {
      if (!matchesAccept(file, accept)) {
        rejected.push({ file, reason: 'type' });
        continue;
      }
      if (maxSize !== undefined && file.size > maxSize) {
        rejected.push({ file, reason: 'size' });
        continue;
      }
      accepted.push(file);
    }

    setErrors(
      rejected.map(
        (item) =>
          `${item.file.name}：${item.reason === 'size' ? labels.tooLarge : labels.wrongType}`,
      ),
    );
    if (rejected.length) onRejected?.(rejected);
    if (accepted.length) onFilesChange(multiple ? [...files, ...accepted] : accepted.slice(0, 1));
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    if (disabled) return;
    accept_(event.dataTransfer.files);
  };

  return (
    <div className={cn('ge-file-upload', className)} {...rest}>
      <div
        className={cn(
          'ge-file-upload__dropzone',
          dragging && 'ge-file-upload__dropzone--dragging',
          disabled && 'ge-file-upload__dropzone--disabled',
        )}
        onDragOver={(event) => {
          event.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        data-testid="file-upload-dropzone"
      >
        <Icon name="upload" size={20} />
        <p className="ge-file-upload__hint">
          {labels.hint}{' '}
          <label htmlFor={inputId} className="ge-file-upload__browse">
            {labels.browse}
          </label>
        </p>
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          className="ge-file-upload__input"
          accept={accept}
          multiple={multiple}
          disabled={disabled}
          onChange={(event: ChangeEvent<HTMLInputElement>) => {
            accept_(event.target.files);
            event.target.value = '';
          }}
          data-testid="file-upload-input"
        />
      </div>

      {errors.length > 0 && (
        <ul className="ge-file-upload__errors" data-testid="file-upload-errors">
          {errors.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      )}

      {files.length > 0 && (
        <ul className="ge-file-upload__list" data-testid="file-upload-list">
          {files.map((file) => (
            <li key={`${file.name}-${file.size}`} className="ge-file-upload__item">
              <Icon name="file" size={16} />
              <span className="ge-file-upload__name">{file.name}</span>
              <span className="ge-file-upload__size">{formatSize(file.size)}</span>
              <IconButton
                size="sm"
                aria-label={`${labels.remove} ${file.name}`}
                disabled={disabled}
                onClick={() => onFilesChange(files.filter((item) => item !== file))}
              >
                <Icon name="close" size={14} />
              </IconButton>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
