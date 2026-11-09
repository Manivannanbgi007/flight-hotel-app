/**
 * Class names of the data tables (admin lists, reports, reservations, queues). Use them with DataTable / TableCard, or
 * on a hand-written <table> that must look the same.
 *
 * Sticky header: below `xl` the card scrolls sideways and the header row scrolls with the page. From `xl` the card
 * clips instead of scrolling (`overflow-x: clip` is not a scroll box, which would trap `position: sticky`), and the
 * header cells stick below the app header (`--app-header-height`, set by the layout) while the page scrolls. A table
 * that can be wider than its card on a desktop must scroll at every width instead: `scrollWrapper` (TableCard `scroll`).
 * The sticky part lives on the card (`stickyHead`), not on `th`, so a header cell in any other scroll box never sticks.
 */

/** The card: rounded, bordered, scrolls sideways (`relative` keeps sr-only cells inside the scroll box). */
const card = 'relative overflow-x-auto rounded-2xl border border-slate-200/80 bg-white';

/** From xl: clip instead of scroll, and the header cells stick under the app header. */
const stickyHead =
  'xl:overflow-x-clip xl:[&_thead_th]:sticky xl:[&_thead_th]:top-[var(--app-header-height,0px)] xl:[&_thead_th]:z-10';

/**
 * Header cell surface: highlighted in the portal colour (a role-100 band), opaque (rows never show
 * through a stuck header), the bottom line drawn inside the cell (an inset shadow), so it moves with the cell when the
 * header sticks; a collapsed table border would stay behind.
 */
const headSurface =
  'bg-[linear-gradient(180deg,color-mix(in_srgb,var(--role-100)_60%,white),var(--role-100))] shadow-[inset_0_-1px_0_var(--role-200)]';

/** Header label type, without colour: small caps. */
const headType = 'text-[0.6875rem]/4 font-bold uppercase tracking-wider';

/** The card's inner corners (rounded-2xl minus its 1 px border), for the outer cells: the card does not clip on xl. */
const headCorners = 'first:rounded-tl-[calc(var(--radius-2xl)_-_1px)] last:rounded-tr-[calc(var(--radius-2xl)_-_1px)]';
const footCorners = [
  '[&>:last-child>tr:last-child>:first-child]:rounded-bl-[calc(var(--radius-2xl)_-_1px)]',
  '[&>:last-child>tr:last-child>:last-child]:rounded-br-[calc(var(--radius-2xl)_-_1px)]',
].join(' ');

export const tableStyles = {
  /** Card around a table: sideways scrolling below xl, sticky header row from xl. The table must fit its card on xl. */
  wrapper: `${card} shadow-card animate-fade-up ${stickyHead}`,
  /** The same card, scrolling sideways at every width (no sticky header): for tables wider than their card on xl. */
  scrollWrapper: `${card} shadow-card animate-fade-up`,
  /** The parts of the wrappers (TableCard builds a card without the shadow from them). */
  card,
  stickyHead,
  /**
   * `min-w-full`: the table fills its card and grows past it only when its cells cannot wrap. The last row's outer
   * cells get the card's inner corner radius, so a hover or totals background does not square the card off on xl.
   */
  table: `min-w-full text-left text-sm ${footCorners}`,
  /**
   * Column header cell: the highlighted band, a bold small-caps label in role-800 (far above 4.5:1 on the band), one
   * line. The first and last cells take the card's inner top corners (the card does not clip on xl). Right-align with
   * `numeric`.
   */
  th: `${headSurface} ${headType} whitespace-nowrap px-4 py-3 text-role-800 ${headCorners}`,
  /** The same header in a compact size (the chart's table view, small tables in their own scroll box). */
  thCompact: `${headSurface} ${headType} whitespace-nowrap px-3 py-2 text-role-800`,
  /** Header parts for grids with their own cell layout (flight comparison, inventory calendar): add a text colour. */
  headSurface,
  headType,
  /** Rows come in one after another (`stagger-rows`, off under reduced motion). */
  tbody: 'divide-y divide-slate-100 stagger-rows',
  /** Hover: a soft role tint (light enough for slate-500 text to keep 4.5:1) and an accent bar on the left. */
  tr: 'transition-[background-color,box-shadow] duration-(--duration-fast) ease-out-soft hover:bg-role-50/40 hover:shadow-[inset_3px_0_0_var(--role-500)]',
  /** A body cell's spacing (no colour): `td` adds the body colour, `primary` the strong one. */
  cell: 'px-4 py-3 align-top',
  td: 'px-4 py-3 align-top text-slate-700',
  /** Numbers (cells and their header): right-aligned, same digit widths. */
  numeric: 'text-right tabular-nums',
  /** The cell with the row's main link or name. */
  primary: 'font-semibold text-slate-900',
} as const;
