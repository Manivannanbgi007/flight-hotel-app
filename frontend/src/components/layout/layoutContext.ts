import { createContext, useContext } from 'react';

/**
 * True below a layout that already draws the header and the <main> landmark (PublicLayout, StaffShell). Pages that
 * can also be shown on their own (access denied, not found, error) add a minimal frame only when this is false.
 */
export const InLayoutContext = createContext(false);

export function useInLayout(): boolean {
  return useContext(InLayoutContext);
}

/**
 * True inside a frame that already gives the page its width, side gutters and backdrop (the customer area beside its
 * sidebar). PageContainer then only lays out its children, so pages need not know where they are shown.
 */
export const InContentFrameContext = createContext(false);

export function useInContentFrame(): boolean {
  return useContext(InContentFrameContext);
}
