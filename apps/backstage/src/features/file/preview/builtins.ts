import { lazy } from 'react';

import { fileExtension, isBrowserImage, registerFilePreviewer } from '@/core/file';

// 開預覽時才載入（plugin 安裝時只登記規則，docs/architecture/frontend/02-plugin-system.md §4.8）
const ImagePreview = lazy(() =>
  import('./ImagePreview').then((module) => ({ default: module.ImagePreview })),
);
const TextPreview = lazy(() =>
  import('./TextPreview').then((module) => ({ default: module.TextPreview })),
);

/** 沒有標 `text/*` 但其實是文字的格式（常見的設定檔、腳本）。 */
const TEXT_EXTENSIONS = new Set([
  'txt',
  'md',
  'csv',
  'log',
  'json',
  'yaml',
  'yml',
  'toml',
  'xml',
  'ini',
  'cfg',
  'lua',
  'js',
  'ts',
  'glsl',
  'shader',
  'py',
  'sh',
]);
const TEXT_TYPES = new Set([
  'application/json',
  'application/ld+json',
  'application/xml',
  'application/javascript',
  'application/x-yaml',
  'application/yaml',
  'application/toml',
  'application/x-sh',
  'application/sql',
]);

/**
 * 內建的兩個預覽解析器（docs/architecture/frontend/12-file-manager.md §6）。
 * 其他格式（PDF、音訊、3D 模型）由 feature 或 plugin 以 `registerFilePreviewer` 擴充。
 */
export function registerBuiltinFilePreviewers(): void {
  registerFilePreviewer({
    id: 'image',
    canPreview: (file) => isBrowserImage(file.contentType),
    component: ImagePreview,
  });
  registerFilePreviewer({
    id: 'text',
    canPreview: (file) =>
      file.contentType.startsWith('text/') ||
      TEXT_TYPES.has(file.contentType) ||
      TEXT_EXTENSIONS.has(fileExtension(file.name)),
    component: TextPreview,
  });
}
