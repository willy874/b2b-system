import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';

import type { AppContext } from './context';

const ReactAppContext = createContext<AppContext | undefined>(undefined);

export function AppContextProvider({
  context,
  children,
}: {
  context: AppContext;
  children: ReactNode;
}) {
  return <ReactAppContext.Provider value={context}>{children}</ReactAppContext.Provider>;
}

export function useAppContext(): AppContext {
  const context = useContext(ReactAppContext);
  if (!context) throw new Error('useAppContext 必須在 AppContextProvider 之內使用');
  return context;
}
