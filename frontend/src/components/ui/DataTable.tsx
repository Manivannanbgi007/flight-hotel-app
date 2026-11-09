import {
  useLayoutEffect, useRef, useState, type HTMLAttributes, type ReactNode, type TdHTMLAttributes, type ThHTMLAttributes,
} from 'react';

import { cn } from '@/lib/cn';
import { tableStyles } from './dataTableStyles';

/**
 * A data table in the design-system look: rounded card, opaque small-caps header row (sticky on wide screens), rows
 * with a soft hover, a caption for screen readers, sideways scrolling on smaller screens. Compose it with Th / Td (or
 * plain cells with `tableStyles`). Sorting, paging and empty states stay with the page (see admin `SortHeader`,
 * `Pagination`, EmptyState).
 */
export function DataTable({ caption, head, children, className, scroll }: {
  /** Read by screen readers before the table ("Bookings, newest first"). */
  caption: string;
  /** The header row's cells (Th). */
  head: ReactNode;
  children: ReactNode;
  className?: string;
  /** See TableCard. */
  scroll?: boolean;
}) {
  return (
    <TableCard caption={caption} className={className} scroll={scroll}>
      <thead>
        <tr>{head}</tr>
      </thead>
      <tbody className={tableStyles.tbody}>{children}</tbody>
    </TableCard>
  );
}

/**
 * The card around a table: the caption (for screen readers), then your thead / tbody / tfoot. Below xl the card
 * scrolls sideways; from xl the header row sticks under the app header while the page scrolls. If the table turns out
 * wider than its card (cells that cannot wrap), the card goes back to scrolling sideways, so nothing is cut off.
 */
export function TableCard({ caption, children, className, scroll = false, flat = false }: {
  caption: string;
  children: ReactNode;
  className?: string;
  /** Always scroll sideways, header never sticks: for tables that can be wider than their card on a desktop. */
  scroll?: boolean;
  /** Without the shadow (a table inside another card). */
  flat?: boolean;
}) {
  const { ref, wider } = useWiderThanCard<HTMLDivElement>(!scroll);
  return (
    <div
      ref={ref}
      className={cn(tableStyles.card, !flat && 'shadow-card', !scroll && !wider && tableStyles.stickyHead, className)}
    >
      <table className={tableStyles.table}>
        <caption className="sr-only">{caption}</caption>
        {children}
      </table>
    </div>
  );
}

/**
 * Whether the card's table is wider than the card (re-measured when either resizes): from xl the card clips instead of
 * scrolling, so a table that does not fit switches its card back to scrolling. Never true without ResizeObserver.
 */
function useWiderThanCard<T extends HTMLElement>(enabled: boolean) {
  const ref = useRef<T>(null);
  const [wider, setWider] = useState(false);
  useLayoutEffect(() => {
    const card = ref.current;
    const table = card?.querySelector('table');
    if (!enabled || !card || !table || typeof ResizeObserver === 'undefined') {
      return undefined;
    }
    // Layout widths (not changed by an entrance animation's transform), both rounded: 1 px of slack.
    const observer = new ResizeObserver(() => setWider(table.offsetWidth > card.clientWidth + 1));
    observer.observe(card);
    observer.observe(table);
    return () => observer.disconnect();
  }, [enabled]);
  return { ref, wider: enabled && wider };
}

export function Tr({ className, ...rest }: HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cn(tableStyles.tr, className)} {...rest} />;
}

export function Th({ numeric = false, className, scope = 'col', ...rest }: ThHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }) {
  return <th scope={scope} className={cn(tableStyles.th, numeric && tableStyles.numeric, className)} {...rest} />;
}

export function Td({ numeric = false, primary = false, className, ...rest }: TdHTMLAttributes<HTMLTableCellElement> & {
  numeric?: boolean;
  primary?: boolean;
}) {
  // One text colour per cell (`cn` does not merge `text-slate-700` and `text-slate-900`).
  return <td className={cn(tableStyles.cell, primary ? tableStyles.primary : 'text-slate-700', numeric && tableStyles.numeric, className)} {...rest} />;
}
