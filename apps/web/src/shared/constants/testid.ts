/** `data-testid="<feature>-<element>-<variant>"`。 */
export const testId = (feature: string, element: string, variant?: string): string =>
  variant ? `${feature}-${element}-${variant}` : `${feature}-${element}`;
