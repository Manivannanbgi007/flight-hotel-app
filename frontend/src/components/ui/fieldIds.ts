import { useId, type ReactNode } from 'react';

/** Ids of a field's control, label, hint and error (the control's own id when given). */
export function useFieldIds(id?: string) {
  const generated = useId();
  const controlId = id ?? generated;
  return { controlId, labelId: `${controlId}-label`, hintId: `${controlId}-hint`, errorId: `${controlId}-error` };
}

/** The hint or the error (never both) describes the control. */
export function describedBy(error: string | undefined, hint: ReactNode, hintId: string, errorId: string): string | undefined {
  if (error) return errorId;
  return hint ? hintId : undefined;
}
