import { cn } from '@/lib/cn';

/**
 * Border, colours and states of a control, without its width and padding. `cn` does not merge Tailwind classes, so a
 * caller's `w-auto` or `py-2` cannot reliably override a `w-full` or `py-2.5` already in the list (the CSS order
 * decides): size variants are options here instead of override classes.
 */
const controlLook = (invalid: boolean) =>
  cn(
    'rounded-xl border bg-white text-sm text-slate-900 shadow-xs placeholder:text-slate-400',
    'transition-[border-color,box-shadow] duration-(--duration-fast) ease-out-soft',
    // Focus in the portal's colour (brand outside the staff portals).
    'hover:border-slate-400 focus-visible:outline-none focus:border-role-600 focus:ring-4 focus:ring-role-600/15',
    'disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500',
    invalid ? 'border-danger-600 focus:border-danger-600 focus:ring-danger-600/15' : 'border-slate-300',
  );

/** Classes of a text-like control (input, select, textarea); exported for custom controls that must match. */
export const controlClass = (invalid: boolean) => cn('block w-full px-3.5 py-2.5', controlLook(invalid));

export interface SelectStyle {
  /** As wide as its options (a sort menu next to text), instead of the full width of its column. */
  inline?: boolean;
  /** `sm`: a compact select (toolbars, the calendar's month and year). */
  size?: 'md' | 'sm';
}

/**
 * A native `<select>` with our chevron and, where the browser supports it, our own open list (`.ui-select` in
 * index.css). Use it on every select, also those without a `SelectField` around them.
 */
export const selectClass = (invalid = false, { inline = false, size = 'md' }: SelectStyle = {}) =>
  cn(
    controlLook(invalid),
    'ui-select',
    inline ? 'inline-block w-auto' : 'block w-full',
    size === 'sm' ? 'py-2 pl-3' : 'py-2.5 pl-3.5',
    // Fallback: room for the background chevron. Customizable select: a flex row whose last item is the chevron.
    'pr-10 supports-[appearance:base-select]:items-center supports-[appearance:base-select]:pr-3',
    inline ? 'supports-[appearance:base-select]:inline-flex' : 'supports-[appearance:base-select]:flex',
  );

/** A drawn checkbox in the portal's accent colour (`.ui-checkbox` in index.css). */
export const checkboxClass = 'ui-checkbox';

/** A drawn radio button in the portal's accent colour (`.ui-radio` in index.css). */
export const radioClass = 'ui-radio';

/** The floating panel of a picker (calendar, time list, suggestions): white, rounded, soft shadow. */
export const floatingPanelClass =
  'rounded-2xl border border-slate-200/80 bg-white p-1.5 text-slate-900 shadow-xl ring-1 ring-slate-900/5';
