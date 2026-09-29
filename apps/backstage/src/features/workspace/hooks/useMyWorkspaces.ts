import { useQuery } from '@tanstack/react-query';

import { getMyWorkspacesQueryOptions } from '@/apis/workspace/get-my-workspaces/query';
import { useHasSession } from '@/core/auth';

/** 自己能進入的工作區（切換器、以網址的 slug 找工作區）。 */
export function useMyWorkspaces() {
  const hasSession = useHasSession();
  return useQuery({ ...getMyWorkspacesQueryOptions(), enabled: hasSession });
}
