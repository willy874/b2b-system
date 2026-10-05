import type { IconName } from '@b2b-system/ui/Icon';

/**
 * 檔案的顯示類型（決定圖示）。比後端的篩選分類（`FileCategory`）細：
 * 例如 `code`、`spreadsheet` 在後端分別屬於 `text`、`document`。
 */
export type FileKind =
  | 'image'
  | 'video'
  | 'audio'
  | 'text'
  | 'code'
  | 'pdf'
  | 'spreadsheet'
  | 'presentation'
  | 'document'
  | 'archive'
  | 'font'
  | 'other';

export const FILE_KIND_ICON = {
  image: 'file-image',
  video: 'file-video',
  audio: 'file-audio',
  text: 'file-text',
  code: 'file-code',
  pdf: 'file-pdf',
  spreadsheet: 'file-spreadsheet',
  presentation: 'file-presentation',
  document: 'file-text',
  archive: 'file-archive',
  font: 'file-font',
  other: 'file',
} as const satisfies Record<FileKind, IconName>;

/** 瀏覽器常把這些檔案回報成空字串或 `application/octet-stream`：以副檔名補判斷。 */
const EXTENSION_KIND: Record<string, FileKind> = {
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  gif: 'image',
  webp: 'image',
  avif: 'image',
  svg: 'image',
  bmp: 'image',
  ico: 'image',
  mp4: 'video',
  webm: 'video',
  mov: 'video',
  mkv: 'video',
  mp3: 'audio',
  wav: 'audio',
  ogg: 'audio',
  flac: 'audio',
  m4a: 'audio',
  txt: 'text',
  md: 'text',
  csv: 'spreadsheet',
  log: 'text',
  json: 'code',
  yaml: 'code',
  yml: 'code',
  toml: 'code',
  xml: 'code',
  js: 'code',
  ts: 'code',
  tsx: 'code',
  jsx: 'code',
  css: 'code',
  html: 'code',
  lua: 'code',
  py: 'code',
  sh: 'code',
  glsl: 'code',
  shader: 'code',
  pdf: 'pdf',
  xls: 'spreadsheet',
  xlsx: 'spreadsheet',
  ods: 'spreadsheet',
  ppt: 'presentation',
  pptx: 'presentation',
  odp: 'presentation',
  doc: 'document',
  docx: 'document',
  odt: 'document',
  rtf: 'document',
  zip: 'archive',
  rar: 'archive',
  '7z': 'archive',
  tar: 'archive',
  gz: 'archive',
  ttf: 'font',
  otf: 'font',
  woff: 'font',
  woff2: 'font',
};

const CODE_TYPES = new Set([
  'application/json',
  'application/ld+json',
  'application/xml',
  'text/xml',
  'application/javascript',
  'text/javascript',
  'text/css',
  'text/html',
  'application/x-yaml',
  'application/yaml',
  'application/toml',
  'application/x-sh',
  'application/sql',
]);

const ARCHIVE_TYPES = new Set([
  'application/zip',
  'application/x-zip-compressed',
  'application/x-7z-compressed',
  'application/x-rar-compressed',
  'application/vnd.rar',
  'application/gzip',
  'application/x-gzip',
  'application/x-tar',
  'application/x-bzip2',
  'application/x-xz',
]);

export function fileExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

function kindFromContentType(contentType: string): FileKind | undefined {
  const type = contentType.toLowerCase().split(';')[0]?.trim() ?? '';
  if (!type || type === 'application/octet-stream') return undefined;
  if (type.startsWith('image/')) return 'image';
  if (type.startsWith('video/')) return 'video';
  if (type.startsWith('audio/')) return 'audio';
  if (type.startsWith('font/')) return 'font';
  if (CODE_TYPES.has(type)) return 'code';
  if (type === 'text/csv') return 'spreadsheet';
  if (type.startsWith('text/')) return 'text';
  if (type === 'application/pdf') return 'pdf';
  if (ARCHIVE_TYPES.has(type)) return 'archive';
  if (type.includes('spreadsheet') || type === 'application/vnd.ms-excel') return 'spreadsheet';
  if (type.includes('presentation') || type === 'application/vnd.ms-powerpoint') {
    return 'presentation';
  }
  if (type.includes('wordprocessing') || type.includes('opendocument.text')) return 'document';
  if (type === 'application/msword' || type === 'application/rtf') return 'document';
  return undefined;
}

/** MIME 優先；看不出來（空字串、octet-stream、罕見型別）再看副檔名。 */
export function getFileKind(contentType: string, name: string): FileKind {
  return kindFromContentType(contentType) ?? EXTENSION_KIND[fileExtension(name)] ?? 'other';
}

/** `<img>` 能直接顯示的點陣／向量圖（排除 tiff、heic 等瀏覽器大多不支援的格式）。 */
const BROWSER_IMAGE_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/svg+xml',
  'image/bmp',
  'image/x-icon',
  'image/vnd.microsoft.icon',
]);

export function isBrowserImage(contentType: string): boolean {
  return BROWSER_IMAGE_TYPES.has(contentType.toLowerCase());
}
