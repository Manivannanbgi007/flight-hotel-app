import { cn } from '@/lib/cn';

const sizes = {
  xs: 'size-6 text-[0.625rem]',
  sm: 'size-8 text-xs',
  md: 'size-10 text-sm',
  lg: 'size-14 text-lg',
  xl: 'size-24 text-2xl',
  '2xl': 'size-28 text-3xl',
} as const;

/** Soft tints for initials; the same name always gets the same tint. */
const tints = [
  'bg-brand-100 text-brand-800',
  'bg-accent-100 text-accent-800',
  'bg-success-100 text-success-700',
  'bg-indigo-100 text-indigo-800',
  'bg-teal-100 text-teal-800',
  'bg-violet-100 text-violet-800',
];

export type AvatarSize = keyof typeof sizes;

/** "Asha Rao" → "AR"; one word → its first letter. */
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.charAt(0) ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.charAt(0) ?? '') : '';
  return `${first}${last}`.toUpperCase();
}

function tintOf(name: string): string {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return tints[hash % tints.length] ?? tints[0]!;
}

/**
 * A person's photo or initials. Decorative by default (the name is written next to it); pass `label` when the avatar
 * stands alone, so screen readers hear the name.
 */
export function Avatar({ name, src, size = 'sm', tint, ring = false, status, label, className }: {
  name: string;
  src?: string | null;
  size?: AvatarSize;
  /** Tailwind classes for the initials' background and text; default: a tint picked from the name. */
  tint?: string;
  /** White ring (avatars on coloured backgrounds or overlapping in a stack). */
  ring?: boolean;
  /** A small presence dot. */
  status?: 'online' | 'away' | 'offline';
  label?: string;
  className?: string;
}) {
  const shape = cn('relative inline-flex shrink-0 rounded-full', sizes[size], ring && 'ring-2 ring-white', className);
  const dot = status && (
    <span
      aria-hidden="true"
      className={cn('absolute bottom-0 right-0 size-1/4 min-h-2 min-w-2 rounded-full ring-2 ring-white',
        status === 'online' ? 'bg-success-500' : status === 'away' ? 'bg-warning-500' : 'bg-slate-400')}
    />
  );
  if (src) {
    return (
      <span className={shape}>
        <img src={src} alt={label ?? ''} className="size-full rounded-full object-cover" />
        {dot}
      </span>
    );
  }
  return (
    <span
      className={cn(shape, 'items-center justify-center font-semibold', tint ?? tintOf(name))}
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
    >
      {initialsOf(name)}
      {dot}
    </span>
  );
}
