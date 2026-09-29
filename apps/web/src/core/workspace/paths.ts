/** 工作區頁面的網址前綴：`/w/:workspaceSlug/…`（docs/adr/0018-workspace-tenancy.md D17）。 */
export const WORKSPACE_PATH_PREFIX = '/w';

/** 同一個頁面換到另一個工作區（工作區切換器用）：`/w/a/file?x` → `/w/b/file`。 */
export function switchWorkspacePath(pathname: string, slug: string): string {
  const [, prefix, , ...rest] = pathname.split('/');
  if (`/${prefix}` !== WORKSPACE_PATH_PREFIX) return `${WORKSPACE_PATH_PREFIX}/${slug}`;
  return [WORKSPACE_PATH_PREFIX, slug, ...rest].join('/');
}

/** 目前網址所在的工作區 slug；不在工作區頁面時是 undefined。 */
export function workspaceSlugOf(pathname: string): string | undefined {
  const [, prefix, slug] = pathname.split('/');
  return `/${prefix}` === WORKSPACE_PATH_PREFIX && slug ? slug : undefined;
}
