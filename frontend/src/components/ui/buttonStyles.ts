import { cn } from '@/lib/cn';

export type ButtonVariant = 'primary' | 'accent' | 'secondary' | 'ghost' | 'danger' | 'role' | 'link';
export type ButtonSize = 'sm' | 'md' | 'lg' | 'icon';

/**
 * Solid buttons get a soft light sheen at the top and a 1 px inner highlight (v3). The sheen is at most 10 % white at the
 * very top edge, where there is no text, so white text keeps its contrast on the 600 step.
 */
const sheen =
  'bg-[linear-gradient(180deg,rgb(255_255_255/0.1),rgb(255_255_255/0)_60%)] shadow-[inset_0_1px_0_rgb(255_255_255/0.18),0_1px_2px_rgb(16_24_40/0.12)]';

const roleSolid = cn(
  sheen,
  'bg-role-600 text-white hover:bg-role-700 active:bg-role-800',
  'hover:shadow-[inset_0_1px_0_rgb(255_255_255/0.18),0_10px_24px_-10px_color-mix(in_srgb,var(--role-600)_60%,transparent)]',
);

const variants: Record<ButtonVariant, string> = {
  /** The portal's accent (role tokens = brand outside the staff portals), so every main action in a portal matches. */
  primary: roleSolid,
  accent: cn(sheen, 'bg-accent-600 text-white hover:bg-accent-700 hover:shadow-glow-accent active:bg-accent-800'),
  secondary:
    'border border-slate-300/90 bg-white text-slate-800 shadow-xs hover:border-slate-400 hover:bg-slate-50 active:bg-slate-100',
  ghost: 'text-slate-700 hover:bg-slate-100 active:bg-slate-200',
  danger: cn(sheen, 'bg-danger-600 text-white hover:bg-danger-700 active:bg-danger-700'),
  /** The portal's accent (brand outside the staff portals). */
  role: roleSolid,
  link: 'h-auto px-0 text-brand-700 underline-offset-4 hover:underline',
};

const sizes: Record<ButtonSize, string> = {
  sm: 'h-8 gap-1.5 rounded-lg px-3 text-sm',
  md: 'h-10 gap-2 rounded-xl px-4 text-sm',
  lg: 'h-12 gap-2 rounded-xl px-6 text-base',
  icon: 'size-10 rounded-xl',
};

/**
 * Classes of a button, for elements that must look like one but are not a <button> (router links:
 * `<Link className={buttonClass({ variant: 'secondary' })}>`).
 */
export function buttonClass({ variant = 'primary', size = 'md', className }: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
} = {}): string {
  return cn(
    'inline-flex shrink-0 select-none items-center justify-center font-semibold whitespace-nowrap',
    'transition-[background-color,border-color,box-shadow,transform,color] duration-(--duration-fast) ease-out-soft',
    'active:translate-y-px disabled:pointer-events-none disabled:opacity-55 aria-disabled:pointer-events-none aria-disabled:opacity-55',
    variant !== 'link' && sizes[size],
    variants[variant],
    className,
  );
}
