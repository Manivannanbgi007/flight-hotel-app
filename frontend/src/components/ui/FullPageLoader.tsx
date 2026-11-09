import { Plane } from 'lucide-react';

/** Page-sized loading state (lazy pages, session restore): a plane circling a soft ring, and what is loading. */
export function FullPageLoader({ label = 'Loading…' }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" className="flex min-h-[50vh] flex-col items-center justify-center gap-4 text-slate-600 animate-fade-in">
      <span aria-hidden="true" className="relative flex size-14 items-center justify-center">
        <span className="absolute inset-0 rounded-full border-4 border-brand-100" />
        <span className="absolute inset-0 animate-spin rounded-full border-4 border-transparent border-t-brand-600 border-r-brand-400" />
        <Plane className="size-5 text-brand-600" />
      </span>
      <span className="text-sm font-medium">{label}</span>
    </div>
  );
}
