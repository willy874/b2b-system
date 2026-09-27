/**
 * S3 的 XML 只用到很小的子集：沒有屬性（根元素的 xmlns 除外）、沒有混合內容、
 * 請求 body 也只有 `<Delete>` 與 `<CompleteMultipartUpload>` 兩種扁平結構，
 * 因此用字串組裝與正規表示式解析即可，不引入 XML 套件。
 */

export const S3_XMLNS = 'http://s3.amazonaws.com/doc/2006-03-01/';

const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8"?>';

const ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;',
};

export function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char);
}

/** 文字節點：內容會被跳脫。 */
export function text(name: string, value: string | number | boolean): string {
  return `<${name}>${escapeXml(String(value))}</${name}>`;
}

/** 容器節點：`children` 必須是已組好的 XML 片段；`false` / `undefined` 會被略過，方便寫條件欄位。 */
export function element(name: string, children: readonly (string | false | undefined)[]): string {
  return `<${name}>${children.filter((child) => typeof child === 'string').join('')}</${name}>`;
}

/** 回應文件：加上 XML 宣告與 S3 命名空間。 */
export function xmlDocument(
  root: string,
  children: readonly (string | false | undefined)[],
): string {
  const body = children.filter((child) => typeof child === 'string').join('');
  return `${XML_DECLARATION}<${root} xmlns="${S3_XMLNS}">${body}</${root}>`;
}

/** 沒有命名空間的回應文件（S3 的 `<Error>` 就是這樣）。 */
export function plainXmlDocument(
  root: string,
  children: readonly (string | false | undefined)[],
): string {
  return `${XML_DECLARATION}${element(root, children)}`;
}

function unescapeXml(value: string): string {
  return value.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos);/g, (_, entity: string) => {
    if (entity.startsWith('#x')) return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    if (entity.startsWith('#')) return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
    return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[entity] ?? '';
  });
}

function tagPattern(name: string): RegExp {
  return new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'g');
}

/** 取出所有 `<name>…</name>` 的原始內容（不跳脫），給巢狀結構逐層往下讀。 */
export function readElements(xml: string, name: string): string[] {
  return [...xml.matchAll(tagPattern(name))].map((match) => match[1] ?? '');
}

/** 取出第一個 `<name>…</name>` 的文字內容（已反跳脫）；`<name/>` 視為空字串。 */
export function readText(xml: string, name: string): string | undefined {
  const [first] = readElements(xml, name);
  if (first !== undefined) return unescapeXml(first);
  return new RegExp(`<${name}(?:\\s[^>]*)?/>`).test(xml) ? '' : undefined;
}
