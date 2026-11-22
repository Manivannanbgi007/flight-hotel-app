import { cn } from '@/lib/cn';

/**
 * Placeholder shape shown while data loads, with a soft shimmer (a plain grey block under reduced motion). Hidden from
 * screen readers: announce loading with a status text next to it (LoadingState does).
 */
export function Skeleton({ className, ...rest }) {
  return <div aria-hidden="true" data-skeleton="" className={cn('skeleton rounded-lg', className)} {...rest} />;
}

/** Lines of text placeholder (the last line shorter). */
export function SkeletonText({ lines = 3, className }) {
  return (
    <div aria-hidden="true" className={cn('flex flex-col gap-2', className)}>
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton key={index} className={cn('h-3.5', index === lines - 1 ? 'w-3/5' : 'w-full')} />
      ))}
    </div>
  );
}
